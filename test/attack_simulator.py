import socket
import json
import time
import sys

attacks = [
    ("10.0.0.1", "Normal login payload"),
    ("10.0.0.2", "DROP TABLE users;"),
    ("10.0.0.3", "admin' OR 1=1--"),
    ("10.0.0.4", "Health check ping")
]

def send_attack(ip, payload):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(('127.0.0.1', 9090))
        data = json.dumps({"ip": ip, "payload": payload})
        s.sendall(data.encode('utf-8'))
        s.close()
        print(f"[X] Sent payload from {ip}: {payload}")
    except Exception as e:
        print(f"[!] Connection error to backend: {e}")

if __name__ == "__main__":
    print("Starting Attack Simulator...")
    for ip, payload in attacks:
        send_attack(ip, payload)
        time.sleep(1)
    print("Simulation complete.")