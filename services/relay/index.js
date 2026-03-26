const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const LOG_FILE = path.join(__dirname, '../../data/engine.log');
const KEY_HEX = process.env.ENGINE_LOG_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const KEY = Buffer.from(KEY_HEX, 'hex');

function decrypt(blob) {
    try {
        if (blob.length < 28) return null; // IV(12) + Tag(16) minimum
        const iv = blob.slice(0, 12);
        const ciphertext = blob.slice(12, -16);
        const tag = blob.slice(-16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
        decipher.setAuthTag(tag);
        let dec = decipher.update(ciphertext, 'binary', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch (e) {
        return null;
    }
}

function parseLogEntry(line) {
    if (line.includes('[METRIC]')) return null;

    // Support: [2026-03-26 15:20:16] [INFO] MESSAGE
    const match = line.match(/\[(.*?)\] \[(.*?)\] (.*)/);
    if (!match) return null;

    const timestamp = match[1];
    const level = match[2];
    const msg = match[3];
    
    let sourceIp = '0.0.0.0';
    let payload = msg;

    const ipMatch = msg.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (ipMatch) sourceIp = ipMatch[1];

    const isCritical = level.includes('SECURITY') || level.includes('CRITICAL') || line.includes('blocked');

    return {
        id: Math.random().toString(36).substr(2, 6).toUpperCase(),
        level: isCritical ? 'CRITICAL' : level,
        sourceIp,
        payload,
        timestamp
    };
}

let lastSize = 0;
if (fs.existsSync(LOG_FILE)) {
    lastSize = fs.statSync(LOG_FILE).size;
}

function watchLog() {
    fs.watch(path.dirname(LOG_FILE), (event, filename) => {
        if (filename === 'engine.log') {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size < lastSize) {
                lastSize = 0; // File truncated/purged
            }
            if (stats.size > lastSize) {
                const fd = fs.openSync(LOG_FILE, 'r');
                let pos = lastSize;
                while (pos < stats.size) {
                    const lenBuf = Buffer.alloc(4);
                    fs.readSync(fd, lenBuf, 0, 4, pos);
                    const len = lenBuf.readUInt32LE(0);
                    pos += 4;

                    if (len === 0xffffffff) {
                        // Plaintext fallback
                        const pLenBuf = Buffer.alloc(4);
                        fs.readSync(fd, pLenBuf, 0, 4, pos);
                        const pLen = pLenBuf.readUInt32LE(0);
                        pos += 4;
                        const dataBuf = Buffer.alloc(pLen);
                        fs.readSync(fd, dataBuf, 0, pLen, pos);
                        pos += pLen;
                        processLine(dataBuf.toString(), dataBuf.toString('hex'));
                    } else {
                        const blob = Buffer.alloc(len);
                        fs.readSync(fd, blob, 0, len, pos);
                        pos += len;
                        const dec = decrypt(blob);
                        processLine(dec, blob.toString('hex'));
                    }
                }
                lastSize = pos;
                fs.closeSync(fd);
            }
        }
    });
}

function processLine(line, rawHex) {
    if (!line) return;
    console.log("Log:", line);
    io.emit('raw-log', line); // Even if it was encrypted, we show the decrypted text in the terminal for "utility"
    
    // Parse for UI
    if (line.includes('[METRIC]')) {
        const cpu = line.match(/CPU: (\d+)%/)?.[1];
        const ram = line.match(/RAM: (\d+)%/)?.[1];
        if (cpu && ram) io.emit('system-vitals', { cpu: parseInt(cpu), ram: parseInt(ram) });
    } else {
        const entry = parseLogEntry(line);
        if (entry) {
            io.emit('packet-received', { ...entry, raw: line });
        }
    }
}

watchLog();

app.post('/api/restart-core', (req, res) => {
    exec('pkill automation_backend', () => res.json({ status: 'ok' }));
});

app.post('/api/purge-logs', (req, res) => {
    fs.writeFileSync(LOG_FILE, '');
    res.json({ status: 'ok' });
});

app.post('/api/save-workflow', (req, res) => {
    const workflow = req.body;
    console.log("Saving workflow:", workflow.name);
    const WORKFLOW_PATH = path.join(__dirname, '../../shared/custom_workflow.json');
    fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(workflow, null, 2));
    
    // Optionally trigger it immediately
    // For now just return success
    res.json({ status: 'saved', path: WORKFLOW_PATH });
});

server.listen(3001, () => console.log('Relay on 3001'));
