(function () {
  'use strict';

  var SUPABASE_URL = 'https://jxifzsbjzmwiwjcyxfcu.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4aWZ6c2Jqem13aXdqY3l4ZmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTk4MTksImV4cCI6MjA5MDMzNTgxOX0.CzKA9rY1ZulYkihDAzhjoDAD5zvGRR7U4Av6ItfmAr8';
  var MASTER_CODE = '123456';
  var ROOM_CODE_RE = /^\d{6}$/;

  var sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var myId = localStorage.getItem('chat-uid');
  if (!myId) {
    myId = 'u_' + Math.random().toString(36).slice(2, 12);
    localStorage.setItem('chat-uid', myId);
  }

  var currentRoomId = null;
  var currentRoomCode = null;
  var currentNickname = '';
  var msgSub = null;
  var memberPoll = null;

  var el = {
    gate: document.getElementById('gate-page'),
    lobby: document.getElementById('lobby-page'),
    chat: document.getElementById('chat-page'),
    gateCode: document.getElementById('gate-invite'),
    gateErr: document.getElementById('gate-error'),
    createName: document.getElementById('create-room-name'),
    createMemberName: document.getElementById('create-member-name'),
    createErr: document.getElementById('create-error'),
    joinRoomCode: document.getElementById('join-room-id'),
    joinMemberName: document.getElementById('join-room-name'),
    joinErr: document.getElementById('join-error'),
    roomList: document.getElementById('room-list'),
    chatTitle: document.getElementById('chat-title'),
    chatSub: document.getElementById('chat-sub'),
    messages: document.getElementById('messages'),
    msgInput: document.getElementById('msg-input'),
    sendBtn: document.getElementById('send-btn'),
    memberList: document.getElementById('member-list'),
    btnBack: document.getElementById('btn-back'),
    btnRename: document.getElementById('btn-rename-room'),
    btnLogout: document.getElementById('btn-logout'),
    btnRefreshRooms: document.getElementById('btn-refresh-rooms')
  };

  function escHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTime(ts) {
    var d = new Date(ts);
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function show(pageEl) {
    [el.gate, el.lobby, el.chat].forEach(function (page) {
      page.classList.add('hidden');
    });
    pageEl.classList.remove('hidden');
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (busy && label) button.textContent = label;
    if (!busy && button.dataset.label) button.textContent = button.dataset.label;
  }

  function normalizeRoomCode(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 6);
  }

  function randomRoomCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function withTimeout(promise, message, ms) {
    var timeoutMs = ms || 12000;
    return Promise.race([
      promise,
      new Promise(function (_resolve, reject) {
        setTimeout(function () {
          reject(new Error(message || '网络超时，请稍后再试'));
        }, timeoutMs);
      })
    ]);
  }

  function humanError(error) {
    var raw = String((error && error.message) || error || '');
    if (/failed to fetch|network|fetch/i.test(raw)) {
      return '连接服务器失败，请检查网络或稍后再试';
    }
    if (/timeout|超时/i.test(raw)) return raw;
    return raw || '请稍后再试';
  }

  function throwIfError(result) {
    if (result && result.error) throw result.error;
    return result;
  }

  async function createUnusedRoomCode() {
    for (var i = 0; i < 24; i += 1) {
      var code = randomRoomCode();
      var result = await withTimeout(
        sb.from('rooms').select('id').eq('invite_code', code).limit(1),
        '连接数据库超时，暂时无法生成房间号'
      );
      throwIfError(result);
      if (!result.data || !result.data.length) return code;
    }
    throw new Error('暂时没有生成可用房间号，请稍后再试');
  }

  async function safeInsertRoom(room) {
    var result = await withTimeout(
      sb.from('rooms').insert(room),
      '连接数据库超时，房间还没有创建成功'
    );
    if (!result.error) return result;

    var duplicated = /duplicate|unique/i.test(result.error.message || '');
    if (duplicated) return { duplicated: true };
    return result;
  }

  async function cleanupRoomSession() {
    if (msgSub) {
      await sb.removeChannel(msgSub);
      msgSub = null;
    }
    if (memberPoll) {
      clearInterval(memberPoll);
      memberPoll = null;
    }
    currentRoomId = null;
    currentRoomCode = null;
    currentNickname = '';
  }

  async function renderMyRooms() {
    el.roomList.innerHTML = '<div class="empty-state">正在读取房间...</div>';

    try {
      var memberResult = await withTimeout(
        sb
          .from('room_members')
          .select('room_id,nickname')
          .eq('user_id', myId)
          .eq('kicked', false),
        '房间列表读取超时'
      );

      if (memberResult.error) throw memberResult.error;

      var members = memberResult.data || [];
      var roomIds = members.map(function (member) { return member.room_id; });

      if (!roomIds.length) {
        el.roomList.innerHTML = '<div class="empty-state">还没有加入任何房间</div>';
        return;
      }

      var roomResult = await withTimeout(
        sb.from('rooms').select('*').in('id', roomIds),
        '房间信息读取超时'
      );
      if (roomResult.error) throw roomResult.error;

      var rooms = roomResult.data || [];

      el.roomList.innerHTML = '';
      rooms.forEach(function (room) {
        var member = members.find(function (item) { return item.room_id === room.id; });
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'room-item';
        button.innerHTML =
          '<span class="room-item-main">' +
            '<span class="room-item-name">' + escHtml(room.name) + '</span>' +
            '<span class="room-item-meta">房间号 ' + escHtml(room.invite_code) + ' · ' + escHtml(member ? member.nickname : '我') + '</span>' +
          '</span>' +
          '<span class="room-enter">进入</span>';
        button.addEventListener('click', function () { enterRoom(room.id); });
        el.roomList.appendChild(button);
      });
    } catch (error) {
      el.roomList.innerHTML = '<div class="empty-state">房间列表读取失败，请点刷新重试</div>';
    }
  }

  function activateTab(tabName) {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.classList.toggle('hidden', panel.dataset.panel !== tabName);
    });
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      activateTab(tab.dataset.tab);
    });
  });

  document.getElementById('form-gate').addEventListener('submit', async function (event) {
    event.preventDefault();
    var code = el.gateCode.value.trim();
    el.gateErr.textContent = '';

    if (code !== MASTER_CODE) {
      el.gateErr.textContent = '总邀请码不正确';
      return;
    }

    localStorage.setItem('chat-gate-ok', '1');
    show(el.lobby);
    renderMyRooms();
  });

  document.getElementById('form-create').addEventListener('submit', async function (event) {
    event.preventDefault();
    var submit = event.submitter || event.target.querySelector('button[type="submit"]');
    var roomName = el.createName.value.trim();
    var nickname = el.createMemberName.value.trim();
    el.createErr.textContent = '';

    if (!roomName) {
      el.createErr.textContent = '请输入房间名字';
      return;
    }
    if (!nickname) {
      el.createErr.textContent = '请输入你在群聊里的名称';
      return;
    }

    submit.dataset.label = submit.textContent;
    setBusy(submit, true, '正在创建...');

    try {
      var room = null;
      for (var i = 0; i < 10; i += 1) {
        var roomCode = await createUnusedRoomCode();
        var roomId = 'r_' + Math.random().toString(36).slice(2, 12);
        var insertResult = await safeInsertRoom({
          id: roomId,
          name: roomName,
          invite_code: roomCode,
          type: 'group',
          host_id: myId
        });

        if (insertResult && insertResult.duplicated) continue;
        if (insertResult.error) throw insertResult.error;
        room = { id: roomId, code: roomCode };
        break;
      }

      if (!room) throw new Error('房间号生成失败，请再试一次');

      throwIfError(await upsertMembership(room.id, nickname));
      throwIfError(await withTimeout(sb.from('messages').insert({
        room_id: room.id,
        sender_id: 'system',
        sender_name: 'system',
        kind: 'system',
        text: nickname + ' 创建了群聊'
      }), '创建系统消息超时'));

      localStorage.setItem('chat-last-name', nickname);
      el.createName.value = '';
      await renderMyRooms();
      enterRoom(room.id);
    } catch (error) {
      el.createErr.textContent = '创建失败：' + humanError(error);
    } finally {
      setBusy(submit, false);
    }
  });

  document.getElementById('form-join').addEventListener('submit', async function (event) {
    event.preventDefault();
    var submit = event.submitter || event.target.querySelector('button[type="submit"]');
    var roomCode = normalizeRoomCode(el.joinRoomCode.value);
    var nickname = el.joinMemberName.value.trim();
    el.joinErr.textContent = '';

    if (!ROOM_CODE_RE.test(roomCode)) {
      el.joinErr.textContent = '请输入 6 位数字房间号';
      return;
    }
    if (!nickname) {
      el.joinErr.textContent = '请输入你在群聊里的名称';
      return;
    }

    submit.dataset.label = submit.textContent;
    setBusy(submit, true, '正在加入...');

    try {
      var roomResult = await withTimeout(
        sb.from('rooms').select('*').eq('invite_code', roomCode).single(),
        '查找房间超时'
      );
      if (!roomResult.data) {
        el.joinErr.textContent = '没有找到这个房间号';
        return;
      }

      var room = roomResult.data;
      var memberResult = await withTimeout(
        sb
          .from('room_members')
          .select('*')
          .eq('room_id', room.id)
          .eq('user_id', myId)
          .maybeSingle(),
        '读取成员信息超时'
      );

      if (memberResult.data && memberResult.data.kicked) {
        el.joinErr.textContent = '你已被房主移出该房间';
        return;
      }

      var isNewMember = !memberResult.data;
      throwIfError(await upsertMembership(room.id, nickname));

      if (isNewMember) {
        throwIfError(await withTimeout(sb.from('messages').insert({
          room_id: room.id,
          sender_id: 'system',
          sender_name: 'system',
          kind: 'system',
          text: nickname + ' 加入了群聊'
        }), '创建系统消息超时'));
      }

      localStorage.setItem('chat-last-name', nickname);
      el.joinRoomCode.value = '';
      await renderMyRooms();
      enterRoom(room.id);
    } catch (error) {
      el.joinErr.textContent = '加入失败：' + humanError(error);
    } finally {
      setBusy(submit, false);
    }
  });

  async function upsertMembership(roomId, nickname) {
    var existing = await withTimeout(
      sb
        .from('room_members')
        .select('room_id')
        .eq('room_id', roomId)
        .eq('user_id', myId)
        .maybeSingle(),
      '检查成员信息超时'
    );

    if (existing.data) {
      return withTimeout(
        sb
          .from('room_members')
          .update({ nickname: nickname, kicked: false })
          .eq('room_id', roomId)
          .eq('user_id', myId),
        '更新群内名称超时'
      );
    }

    return withTimeout(
      sb.from('room_members').insert({
        room_id: roomId,
        user_id: myId,
        nickname: nickname
      }),
      '加入房间超时'
    );
  }

  async function enterRoom(roomId) {
    currentRoomId = roomId;
    var roomResult = await withTimeout(
      sb.from('rooms').select('*').eq('id', roomId).single(),
      '读取房间信息超时'
    );
    var room = roomResult.data;

    if (!room) {
      alert('房间不存在');
      return;
    }

    var memberResult = await withTimeout(
      sb
        .from('room_members')
        .select('nickname,kicked')
        .eq('room_id', roomId)
        .eq('user_id', myId)
        .maybeSingle(),
      '读取你的群内名称超时'
    );

    if (!memberResult.data || memberResult.data.kicked) {
      alert('你还没有加入这个房间');
      await renderMyRooms();
      show(el.lobby);
      return;
    }

    currentRoomCode = room.invite_code;
    currentNickname = memberResult.data.nickname;
    el.chatTitle.textContent = room.name;
    el.chatSub.textContent = '房间号：' + room.invite_code + ' · 群内名称：' + currentNickname;
    el.btnRename.classList.toggle('hidden', room.host_id !== myId);

    show(el.chat);
    await loadMessages(roomId);
    await renderMembers(roomId);

    if (msgSub) await sb.removeChannel(msgSub);
    msgSub = sb.channel('messages-' + roomId)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: 'room_id=eq.' + roomId
      }, function (payload) {
        if (payload.new.sender_id === myId) return;
        appendMessage(payload.new);
        scrollToBottom();
      })
      .subscribe();

    if (memberPoll) clearInterval(memberPoll);
    memberPoll = setInterval(function () { renderMembers(roomId); }, 10000);
  }

  async function loadMessages(roomId) {
    el.messages.innerHTML = '';
    var result = await withTimeout(
      sb
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(200),
      '消息读取超时'
    );
    (result.data || []).forEach(function (msg) { appendMessage(msg); });
    scrollToBottom();
  }

  function appendMessage(msg) {
    var div = document.createElement('div');

    if (msg.kind === 'system') {
      div.className = 'system-msg';
      div.textContent = msg.text;
      el.messages.appendChild(div);
      return;
    }

    var isMine = msg.sender_id === myId;
    div.className = 'msg ' + (isMine ? 'mine' : 'theirs');
    div.innerHTML =
      (!isMine ? '<span class="msg-sender">' + escHtml(msg.sender_name) + '</span>' : '') +
      '<div class="msg-bubble">' + escHtml(msg.text).replace(/\n/g, '<br>') + '</div>' +
      '<span class="msg-time">' + formatTime(msg.created_at) + '</span>';
    el.messages.appendChild(div);
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  async function renderMembers(roomId) {
    var memberResult = await withTimeout(
      sb
        .from('room_members')
        .select('*')
        .eq('room_id', roomId)
        .eq('kicked', false),
      '成员列表读取超时'
    );
    var roomResult = await withTimeout(
      sb.from('rooms').select('host_id').eq('id', roomId).single(),
      '房主信息读取超时'
    );
    var hostId = roomResult.data ? roomResult.data.host_id : null;

    el.memberList.innerHTML = '';
    (memberResult.data || []).forEach(function (member) {
      var row = document.createElement('div');
      row.className = 'member-row';
      row.innerHTML =
        '<span class="member-name-wrap">' +
          '<span class="member-name">' + escHtml(member.nickname) + '</span>' +
          (member.user_id === hostId ? '<span class="badge-host">房主</span>' : '') +
          (member.user_id === myId ? '<span class="badge-me">我</span>' : '') +
        '</span>';

      if (hostId === myId && member.user_id !== myId) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = '移出';
        button.className = 'btn-kick';
        button.addEventListener('click', function () {
          kickMember(roomId, member.user_id, member.nickname);
        });
        row.appendChild(button);
      }

      el.memberList.appendChild(row);
    });
  }

  async function kickMember(roomId, targetId, targetName) {
    if (!confirm('确定移出 ' + targetName + '？')) return;
    await sb
      .from('room_members')
      .update({ kicked: true })
      .eq('room_id', roomId)
      .eq('user_id', targetId);
    await sb.from('messages').insert({
      room_id: roomId,
      sender_id: 'system',
      sender_name: 'system',
      kind: 'system',
      text: targetName + ' 已被移出群聊'
    });
    renderMembers(roomId);
  }

  async function sendMsg() {
    var text = el.msgInput.value.trim();
    if (!text || !currentRoomId) return;

    el.msgInput.value = '';
    el.msgInput.style.height = 'auto';

    var msg = {
      room_id: currentRoomId,
      sender_id: myId,
      sender_name: currentNickname,
      kind: 'chat',
      text: text,
      created_at: new Date().toISOString()
    };

    appendMessage(msg);
    scrollToBottom();

    var result = await sb.from('messages').insert(msg);
    if (result.error) {
      var failed = {
        room_id: currentRoomId,
        sender_id: 'system',
        sender_name: 'system',
        kind: 'system',
        text: '消息发送失败，请检查网络后重试'
      };
      appendMessage(failed);
      scrollToBottom();
    }
  }

  el.sendBtn.addEventListener('click', sendMsg);
  el.msgInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMsg();
    }
  });
  el.msgInput.addEventListener('input', function () {
    el.msgInput.style.height = 'auto';
    el.msgInput.style.height = Math.min(el.msgInput.scrollHeight, 120) + 'px';
  });

  el.btnBack.addEventListener('click', async function () {
    await cleanupRoomSession();
    await renderMyRooms();
    show(el.lobby);
  });

  el.btnRename.addEventListener('click', async function () {
    var newName = prompt('请输入新的房间名字：', el.chatTitle.textContent);
    if (!newName || !newName.trim()) return;
    newName = newName.trim().slice(0, 40);
    var result = await sb
      .from('rooms')
      .update({ name: newName })
      .eq('id', currentRoomId)
      .eq('host_id', myId);

    if (result.error) {
      alert('改名失败：' + result.error.message);
      return;
    }

    el.chatTitle.textContent = newName;
  });

  el.btnLogout.addEventListener('click', async function () {
    await cleanupRoomSession();
    localStorage.removeItem('chat-gate-ok');
    show(el.gate);
  });

  el.btnRefreshRooms.addEventListener('click', renderMyRooms);

  el.joinRoomCode.addEventListener('input', function () {
    el.joinRoomCode.value = normalizeRoomCode(el.joinRoomCode.value);
  });

  var savedName = localStorage.getItem('chat-last-name');
  if (savedName) {
    el.joinMemberName.value = savedName;
    el.createMemberName.value = savedName;
  }

  if (localStorage.getItem('chat-gate-ok') === '1') {
    show(el.lobby);
    renderMyRooms();
  }
})();
