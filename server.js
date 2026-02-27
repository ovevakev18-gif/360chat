require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const API_KEY = process.env.API_KEY;
const WABA_URL = 'https://waba-v2.360dialog.io';

let chats = {};
let messages = {};

// ================= WEBSOCKET =================

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ================= WEBHOOK =================

app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  const body = req.body;

  const value = body?.entry?.[0]?.changes?.[0]?.value;
  if (!value) return;

  // Входящие сообщения
  if (value.messages) {
    value.messages.forEach(msg => {
      const phone = msg.from;
      const text = msg.text?.body || '[media]';
      const wabaId = msg.id;

      if (!chats[phone]) {
        chats[phone] = {
          phone,
          name: '+' + phone,
          unread: 0
        };
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

      broadcast({ type: 'new_message', phone });
    });
  }

  // Статусы
  if (value.statuses) {
    value.statuses.forEach(status => {
      const phone = status.recipient_id;
      const msgId = status.id;

      if (!messages[phone]) return;

      const msg = messages[phone].find(m => m.wabaId === msgId);
      if (msg) {
        msg.status = status.status;
      }

      broadcast({
        type: 'status_update',
        phone,
        wabaId: msgId,
        status: status.status
      });
    });
  }
});

// ================= SEND MESSAGE =================

app.post('/api/send', async (req, res) => {
  let { phone, text } = req.body;

  phone = phone.replace('+', '');

  console.log("SENDING TO:", phone);

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

    broadcast({ type: 'message_sent', phone });

    res.json({ success: true });

  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// ================= API =================

app.get('/api/chats', (req, res) => {
  res.json(Object.values(chats));
});

app.get('/api/messages/:phone', (req, res) => {
  res.json(messages[req.params.phone] || []);
});

// ================= START =================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('🚀 WhatsApp Server Running on port', PORT);
});
