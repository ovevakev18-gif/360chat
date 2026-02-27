const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const API_KEY = process.env.API_KEY || '62MY9vMEMnTNH6wOBR7s8EAWAK';
const WABA_URL = 'https://waba-v2.360dialog.io';

// In-memory storage
let chats = {};
let messages = {};

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Webhook — incoming messages from 360dialog
app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  const body = req.body;

  const messagesArr =
    body?.entry?.[0]?.changes?.[0]?.value?.messages;

  if (!messagesArr) return;

  messagesArr.forEach(msg => {
    if (msg.type !== 'text') return;

    const phone = msg.from;
    const text = msg.text?.body;
    const ts = msg.timestamp ? msg.timestamp * 1000 : Date.now();

    if (!chats[phone]) {
      chats[phone] = {
        name: '+' + phone,
        phone,
        unread: 0,
        lastMessage: text,
        lastTs: ts
      };
      messages[phone] = [];
    }

    messages[phone].push({
      id: Date.now() + Math.random(),
      text,
      from: phone,
      ts,
      status: 'recv'
    });

    chats[phone].lastMessage = text;
    chats[phone].lastTs = ts;
    chats[phone].unread = (chats[phone].unread || 0) + 1;

    broadcast({
      type: 'new_message',
      phone,
      message: { text, from: phone, ts }
    });
  });
});

// Send message
app.post('/api/send', async (req, res) => {
  const { phone, text } = req.body;
  try {
    const resp = await axios.post(`${WABA_URL}/v1/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { body: text }
    }, { headers: { 'D360-API-KEY': API_KEY, 'Content-Type': 'application/json' } });

    if (!messages[phone]) messages[phone] = [];
    messages[phone].push({ id: Date.now(), text, from: 'me', ts: Date.now(), status: 'sent' });
    if (chats[phone]) { chats[phone].lastMessage = text; chats[phone].lastTs = Date.now(); }
    broadcast({ type: 'message_sent', phone });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// Get chats
app.get('/api/chats', (req, res) => res.json(Object.values(chats)));

// Get messages
app.get('/api/messages/:phone', (req, res) => res.json(messages[req.params.phone] || []));

// Create chat
app.post('/api/chats', (req, res) => {
  const { name, phone } = req.body;
  if (!chats[phone]) {
    chats[phone] = { name, phone, unread: 0, lastMessage: '', lastTs: Date.now() };
    messages[phone] = [];
  }
  res.json(chats[phone]);
});

// Mark read
app.post('/api/chats/:phone/read', (req, res) => {
  if (chats[req.params.phone]) chats[req.params.phone].unread = 0;
  res.json({ ok: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
