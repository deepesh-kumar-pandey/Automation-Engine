const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const LOG_FILE = path.join(__dirname, '../../data/engine.log');
const KEY_HEX = process.env.ENGINE_LOG_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const KEY = Buffer.from(KEY_HEX, 'hex');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    let enc = cipher.update(text, 'utf8', 'binary');
    enc += cipher.final('binary');
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, Buffer.from(enc, 'binary'), tag]);
}

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

// ── Simulator ingest endpoint ─────────────────────────────────────────────────
// Accepts packets from dashboard_stress_test.py and broadcasts to all clients.
app.post('/api/ingest-log', (req, res) => {
    const { line, level, sourceIp, payload, timestamp, id } = req.body;
    if (!line) return res.status(400).json({ error: 'missing line' });

    // broadcast raw log line
    io.emit('raw-log', line);

    // parse [METRIC] vitals
    if (line.includes('[METRIC]')) {
        const cpu = line.match(/CPU:\s*(\d+)%/)?.[1];
        const ram = line.match(/RAM:\s*(\d+)%/)?.[1];
        if (cpu && ram) io.emit('system-vitals', { cpu: parseInt(cpu), ram: parseInt(ram) });
        return res.json({ status: 'ok' });
    }

    // broadcast structured packet for the feed table
    const lvl = level || 'INFO';
    const isCritical = lvl === 'CRITICAL' || (payload || '').toLowerCase().includes('drop table')
        || (payload || '').includes('OR 1=1') || (payload || '').includes('UNION SELECT');

    const packet = {
        id:        id || Math.random().toString(36).slice(2, 8).toUpperCase(),
        level:     isCritical ? 'CRITICAL' : lvl,
        sourceIp:  sourceIp || '0.0.0.0',
        payload:   payload  || line,
        timestamp: timestamp || new Date().toLocaleTimeString(),
        raw:       line,
    };
    io.emit('packet-received', packet);
    res.json({ status: 'ok' });
});

app.post('/api/purge-logs', (req, res) => {
    fs.writeFileSync(LOG_FILE, '');
    res.json({ status: 'ok' });
});

app.post('/api/save-workflow', async (req, res) => {
    const workflow = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO workflows (name, schema_type, parameters) VALUES ($1, $2, $3) RETURNING id',
            [workflow.name, workflow.schema || 'custom', JSON.stringify(workflow)]
        );
        res.json({ status: 'saved', id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/workflows', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM workflows ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error("Query error:", err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/workflows/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM workflows WHERE id = $1', [req.params.id]);
        res.json({ status: 'deleted' });
    } catch (err) {
        console.error("Delete error:", err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/execute-workflow', (req, res) => {
    const workflow = req.body;
    const payload = JSON.stringify(workflow);
    const encryptedPayload = encrypt(payload);

    // Send to C++ backend on port 9090
    const net = require('net');
    const client = new net.Socket();
    client.connect(9090, '127.0.0.1', () => {
        client.write(encryptedPayload);
        client.end();
    });

    client.on('error', (err) => {
        console.error("TCP Connection error:", err);
    });

    res.json({ status: 'sent' });
});

server.listen(3001, () => console.log('Relay on 3001'));
