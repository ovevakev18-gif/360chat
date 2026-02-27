const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const API_KEY = process.env.API_KEY;
const WABA_URL = 'https://waba-v2.360dialog.io';

let chats = {};
let messages = {};

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  if (!value) return;

  if (value.messages) {
    for (const msg of value.messages) {
      const phone = msg.from.replace(/\D/g, '');
      const text = msg.text?.body || '[media]';
      const wabaId = msg.id;

      try {
        await axios.post(
          `${WABA_URL}/messages`,
          {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: wabaId
          },
          {
            headers: {
              'D360-API-KEY': API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (err) {
        console.log('Read error:', err.message);
      }

      if (!chats[phone]) {
        chats[phone] = { phone, name: '+' + phone, unread: 0 };
        messages[phone] = [];
      }

      messages[phone].push({
        id: uuidv4(),
        wabaId,
        text,
        from: phone,
        status: 'received',
        ts: Date.now()
      });

      chats[phone].unread++;
      broadcast({ type: 'refresh' });
    }
  }

  if (value.statuses) {
    for (const status of value.statuses) {
      const phone = status.recipient_id.replace(/\D/g, '');
      const msgId = status.id;

      if (!messages[phone]) continue;

      const msg = messages[phone].find(m => m.wabaId === msgId);
      if (msg) msg.status = status.status;

      broadcast({ type: 'refresh' });
    }
  }
});

app.post('/api/send', async (req, res) => {
  let { phone, text } = req.body;
  phone = phone.replace(/\D/g, '');

  try {
    const response = await axios.post(
      `${WABA_URL}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          'D360-API-KEY': API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const wabaId = response.data.messages[0].id;

    if (!messages[phone]) messages[phone] = [];

    messages[phone].push({
      id: uuidv4(),
      wabaId,
      text,
      from: 'me',
      status: 'sent',
      ts: Date.now()
    });

    broadcast({ type: 'refresh' });

    res.json({ success: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chats', (req, res) => {
  res.json(Object.values(chats));
});

app.get('/api/messages/:phone', (req, res) => {
  res.json(messages[req.params.phone] || []);
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log('🚀 WhatsApp Server Running on port', PORT);
});
