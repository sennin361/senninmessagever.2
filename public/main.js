const socket = io();
let nickname = '';
let currentRoom = null;

function joinRoom() {
  nickname = document.getElementById('nickname').value;
  currentRoom = document.getElementById('room').value;
  if (!nickname || !currentRoom) return alert('ニックネームとルームを入力');

  socket.emit('join-room', { room: currentRoom });
  document.getElementById('join').style.display = 'none';
  document.getElementById('chat').style.display = 'block';
  document.getElementById('leave-button').style.display = 'inline-block';
}

function leaveRoom() {
  if (currentRoom) {
    socket.emit('leave-room', { room: currentRoom });
    currentRoom = null;
    document.getElementById('chat').style.display = 'none';
    document.getElementById('join').style.display = 'block';
    document.getElementById('leave-button').style.display = 'none';
    clearChat();
  }
}

function clearChat() {
  document.getElementById('messages').innerHTML = '';
}

function sendMessage() {
  const msg = document.getElementById('message').value;
  const file = document.getElementById('imageInput').files[0];
  if (msg) {
    socket.emit('chat-message', { room: currentRoom, nickname, message: msg });
    addMessage(nickname, msg, true);
    document.getElementById('message').value = '';
  } else if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('image-message', { room: currentRoom, nickname, image: reader.result });
      addImage(nickname, reader.result, true);
    };
    reader.readAsDataURL(file);
  }
}

socket.on('chat-message', ({ nickname, message }) => {
  addMessage(nickname, message, false);
});

socket.on('image-message', ({ nickname, image }) => {
  addImage(nickname, image, false);
});

function addMessage(name, text, isMe) {
  const div = document.createElement('div');
  div.className = 'bubble ' + (isMe ? 'my' : 'other');
  div.innerHTML = `<small>${name}</small><br>${text}`;
  document.getElementById('messages').appendChild(div);
}

function addImage(name, image, isMe) {
  const div = document.createElement('div');
  div.className = 'bubble ' + (isMe ? 'my' : 'other');
  div.innerHTML = `<small>${name}</small><br><img src="${image}" style="max-width:100%;">`;
  document.getElementById('messages').appendChild(div);
}

// 管理者機能
function showAdminLogin() {
  const form = document.getElementById('admin-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function sendAdminCommand() {
  const pw = document.getElementById('admin-password').value;
  if (pw === 'sennin1945') {
    socket.emit('admin-login');
    alert('管理者モードを有効にしました');
    document.getElementById('admin-form').style.display = 'none';
    document.getElementById('admin-log').style.display = 'block';
  } else {
    alert('パスワードが違います');
  }
}

socket.on('admin-message-log', data => {
  const logBox = document.getElementById('admin-messages');
  const { room, nickname, message, type } = data;
  const msgDiv = document.createElement('div');
  msgDiv.innerHTML = `<strong>[${room}] ${nickname}:</strong> ${
    type === 'image' ? `<img src="${message}" style="max-width:100%;">` : message
  }`;
  logBox.appendChild(msgDiv);
});
