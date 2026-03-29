(function () {
  'use strict';

  // ===== 配置 =====
  var SUPABASE_URL = 'https://jxifzsbjzmwiwjcyxfcu.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4aWZ6c2Jqem13aXdqY3l4ZmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTk4MTksImV4cCI6MjA5MDMzNTgxOX0.CzKA9rY1ZulYkihDAzhjoDAD5zvGRR7U4Av6ItfmAr8';
  var MASTER_CODE = '123456'; // 总邀请码，可以改

  var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ===== 状态 =====
  var myId = localStorage.getItem('chat-uid');
  if (!myId) { myId = 'u_' + Math.random().toString(36).substr(2, 10); localStorage.setItem('chat-uid', myId); }
  var myName = '';
  var currentRoomId = null;
  var msgSub = null;
  var memberPoll = null;

  // ===== DOM =====
  var el = {
    gate: document.getElementById('gate-page'),
    lobby: document.getElementById('lobby-page'),
    chat: document.getElementById('chat-page'),
    gateCode: document.getElementById('gate-invite'),
    gateName: document.getElementById('gate-nickname'),
    gateErr: document.getElementById('gate-error'),
    lobbyName: document.getElementById('lobby-display-name'),
    createName: document.getElementById('create-room-name'),
    createCode: document.getElementById('create-room-code'),
    createType: document.getElementById('create-room-type'),
    createErr: document.getElementById('create-error'),
    myRooms: document.getElementById('my-rooms'),
    joinId: document.getElementById('join-room-id'),
    joinCode: document.getElementById('join-room-code'),
    joinErr: document.getElementById('join-error'),
    chatTitle: document.getElementById('chat-title'),
    chatSub: document.getElementById('chat-sub'),
    messages: document.getElementById('messages'),
    msgInput: document.getElementById('msg-input'),
    sendBtn: document.getElementById('send-btn'),
    memberList: document.getElementById('member-list'),
    btnBack: document.getElementById('btn-back'),
    btnRename: document.getElementById('btn-rename-room')
  };

  // ===== 工具 =====
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function formatTime(ts) {
    var d = new Date(ts);
    return d.toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }
  function show(pageEl) {
    [el.gate, el.lobby, el.chat].forEach(function(p){ p.classList.add('hidden'); });
    pageEl.classList.remove('hidden');
  }

  // ===== 第一步：总邀请码 + 昵称 =====
  document.getElementById('form-gate').addEventListener('submit', async function(e) {
    e.preventDefault();
    var code = el.gateCode.value.trim();
    var name = el.gateName.value.trim();
    el.gateErr.textContent = '';
    if (code !== MASTER_CODE) { el.gateErr.textContent = '总邀请码不正确'; return; }
    if (!name) { el.gateErr.textContent = '请输入昵称'; return; }
    myName = name;
    localStorage.setItem('chat-name', name);
    el.lobbyName.textContent = name;
    await renderMyRooms();
    show(el.lobby);
  });

  // ===== 大厅：我的房间列表 =====
  async function renderMyRooms() {
    var { data } = await sb.from('room_members').select('room_id').eq('user_id', myId).eq('kicked', false);
    var roomIds = (data || []).map(function(r){ return r.room_id; });
    if (!roomIds.length) { el.myRooms.innerHTML = '<p style="color:#999;font-size:13px;">暂无房间</p>'; return; }
    var { data: rooms } = await sb.from('rooms').select('*').in('id', roomIds);
    el.myRooms.innerHTML = '';
    (rooms || []).forEach(function(room) {
      var div = document.createElement('div');
      div.className = 'room-card';
      div.innerHTML = '<span class="room-name">' + escHtml(room.name) + '</span>' +
        '<span class="room-meta">' + (room.type === 'private' ? '私聊' : '群聊') + ' · 码：' + escHtml(room.invite_code) + '</span>';
      div.addEventListener('click', function(){ enterRoom(room.id); });
      el.myRooms.appendChild(div);
    });
  }

  // ===== 大厅：创建房间 =====
  document.getElementById('form-create').addEventListener('submit', async function(e) {
    e.preventDefault();
    var name = el.createName.value.trim();
    var code = el.createCode.value.trim();
    var type = el.createType ? el.createType.value : 'group';
    el.createErr.textContent = '';
    if (!name) { el.createErr.textContent = '请输入房间名'; return; }
    if (!code) { el.createErr.textContent = '请输入邀请码'; return; }
    // 检查邀请码是否已存在
    var { data: exist } = await sb.from('rooms').select('id').eq('invite_code', code);
    if (exist && exist.length) { el.createErr.textContent = '该邀请码已被使用，请换一个'; return; }
    var roomId = 'r_' + Math.random().toString(36).substr(2, 10);
    var { error } = await sb.from('rooms').insert({ id: roomId, name: name, invite_code: code, type: type, host_id: myId });
    if (error) { el.createErr.textContent = '创建失败：' + error.message; return; }
    await sb.from('room_members').insert({ room_id: roomId, user_id: myId, nickname: myName });
    await sb.from('messages').insert({ room_id: roomId, sender_id: 'system', sender_name: 'system', kind: 'system', text: myName + ' 创建了聊天室' });
    el.createName.value = '';
    el.createCode.value = '';
    await renderMyRooms();
    enterRoom(roomId);
  });

  // ===== 大厅：加入房间 =====
  document.getElementById('form-join').addEventListener('submit', async function(e) {
    e.preventDefault();
    var code = el.joinCode.value.trim();
    el.joinErr.textContent = '';
    if (!code) { el.joinErr.textContent = '请输入邀请码'; return; }
    var { data: rooms } = await sb.from('rooms').select('*').eq('invite_code', code);
    if (!rooms || !rooms.length) { el.joinErr.textContent = '邀请码不正确'; return; }
    var room = rooms[0];
    // 检查是否被踢
    var { data: mem } = await sb.from('room_members').select('*').eq('room_id', room.id).eq('user_id', myId).single();
    if (mem && mem.kicked) { el.joinErr.textContent = '你已被房主移出该房间'; return; }
    if (!mem) {
      if (room.type === 'private') {
        var { data: existing } = await sb.from('room_members').select('*').eq('room_id', room.id).eq('kicked', false);
        if (existing && existing.length >= 2) { el.joinErr.textContent = '私聊房间已满（仅支持2人）'; return; }
      }
      await sb.from('room_members').insert({ room_id: room.id, user_id: myId, nickname: myName });
      await sb.from('messages').insert({ room_id: room.id, sender_id: 'system', sender_name: 'system', kind: 'system', text: myName + ' 加入了聊天室' });
    }
    el.joinCode.value = '';
    await renderMyRooms();
    enterRoom(room.id);
  });

  // ===== 进入聊天室 =====
  async function enterRoom(roomId) {
    currentRoomId = roomId;
    var { data: room } = await sb.from('rooms').select('*').eq('id', roomId).single();
    if (!room) { alert('房间不存在'); return; }

    el.chatTitle.textContent = room.name;
    el.chatSub.textContent = (room.type === 'private' ? '私聊' : '群聊') + ' · 邀请码：' + room.invite_code;

    // 房主才能改名
    if (room.host_id === myId) {
      el.btnRename.classList.remove('hidden');
    } else {
      el.btnRename.classList.add('hidden');
    }

    show(el.chat);
    await loadMessages(roomId);
    await renderMembers(roomId);

    // 实时订阅消息
    if (msgSub) { sb.removeChannel(msgSub); }
    msgSub = sb.channel('messages-' + roomId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'room_id=eq.' + roomId },
        function(payload) { appendMessage(payload.new); scrollToBottom(); })
      .subscribe();

    // 定时刷新成员列表
    if (memberPoll) clearInterval(memberPoll);
    memberPoll = setInterval(function(){ renderMembers(roomId); }, 10000);
  }

  async function loadMessages(roomId) {
    el.messages.innerHTML = '';
    var { data } = await sb.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).limit(200);
    (data || []).forEach(function(msg){ appendMessage(msg); });
    scrollToBottom();
  }

  function appendMessage(msg) {
    var div = document.createElement('div');
    if (msg.kind === 'system') {
      div.className = 'msg-system';
      div.textContent = msg.text;
    } else {
      var isMine = msg.sender_id === myId;
      div.className = 'msg-row ' + (isMine ? 'mine' : 'theirs');
      div.innerHTML = (!isMine ? '<span class="msg-name">' + escHtml(msg.sender_name) + '</span>' : '') +
        '<div class="msg-bubble">' + escHtml(msg.text).replace(/\n/g, '<br>') + '</div>' +
        '<span class="msg-time">' + formatTime(msg.created_at) + '</span>';
    }
    el.messages.appendChild(div);
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  async function renderMembers(roomId) {
    var { data } = await sb.from('room_members').select('*').eq('room_id', roomId).eq('kicked', false);
    var { data: room } = await sb.from('rooms').select('host_id').eq('id', roomId).single();
    var hostId = room ? room.host_id : null;
    el.memberList.innerHTML = '';
    (data || []).forEach(function(m) {
      var div = document.createElement('div');
      div.className = 'member-item';
      var label = escHtml(m.nickname) + (m.user_id === hostId ? ' 👑' : '') + (m.user_id === myId ? ' (我)' : '');
      div.innerHTML = '<span>' + label + '</span>';
      // 房主可以踢人（不能踢自己）
      if (hostId === myId && m.user_id !== myId) {
        var btn = document.createElement('button');
        btn.textContent = '移出';
        btn.className = 'btn-kick';
        btn.addEventListener('click', function(){ kickMember(roomId, m.user_id, m.nickname); });
        div.appendChild(btn);
      }
      el.memberList.appendChild(div);
    });
  }

  async function kickMember(roomId, targetId, targetName) {
    if (!confirm('确定移出 ' + targetName + '？')) return;
    await sb.from('room_members').update({ kicked: true }).eq('room_id', roomId).eq('user_id', targetId);
    await sb.from('messages').insert({ room_id: roomId, sender_id: 'system', sender_name: 'system', kind: 'system', text: targetName + ' 已被移出聊天室' });
    renderMembers(roomId);
  }

  // ===== 发送消息 =====
  el.sendBtn.addEventListener('click', sendMsg);
  el.sendBtn.addEventListener('click', function() { sendMsg(); });
  el.msgInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });

  async function sendMsg() {
    var text = el.msgInput.value.trim();
    if (!text || !currentRoomId) return;
    el.msgInput.value = '';
    el.msgInput.style.height = 'auto';
    var msg = { room_id: currentRoomId, sender_id: myId, sender_name: myName, kind: 'chat', text: text, created_at: new Date().toISOString() };
    appendMessage(msg);
    scrollToBottom();
    await sb.from('messages').insert(msg);
  }

  // ===== 返回大厅 =====
  el.btnBack.addEventListener('click', async function() {
    if (msgSub) { sb.removeChannel(msgSub); msgSub = null; }
    if (memberPoll) { clearInterval(memberPoll); memberPoll = null; }
    currentRoomId = null;
    await renderMyRooms();
    show(el.lobby);
  });

  // ===== 改名（房主专属）=====
  el.btnRename.addEventListener('click', async function() {
    var newName = prompt('请输入新的聊天室名称：', el.chatTitle.textContent);
    if (!newName || !newName.trim()) return;
    newName = newName.trim();
    await sb.from('rooms').update({ name: newName }).eq('id', currentRoomId).eq('host_id', myId);
    el.chatTitle.textContent = newName;
  });

  // ===== 自动恢复昵称 =====
  var savedName = localStorage.getItem('chat-name');
  if (savedName) { el.gateName.value = savedName; }

})();
