const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const adminSockets = new Set();

io.on('connection', socket => {
  socket.on('join-room', ({ room }) => {
    socket.join(room);
  });

  socket.on('leave-room', ({ room }) => {
    socket.leave(room);
  });

  socket.on('chat-message', ({ room, nickname, message }) => {
    socket.to(room).emit('chat-message', { nickname, message });
    for (let admin of adminSockets) {
      admin.emit('admin-message-log', { room, nickname, message, type: 'text' });
    }
  });

  socket.on('image-message', ({ room, nickname, image }) => {
    socket.to(room).emit('image-message', { nickname, image });
    for (let admin of adminSockets) {
      admin.emit('admin-message-log', { room, nickname, message: image, type: 'image' });
    }
  });

  socket.on('admin-login', () => {
    adminSockets.add(socket);
  });

  socket.on('admin-reset', () => {
    for (const [id, sock] of io.sockets.sockets) {
      sock.disconnect(true);
    }
  });

  socket.on('disconnect', () => {
    adminSockets.delete(socket);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`サーバー起動中 http://localhost:${PORT}`));
