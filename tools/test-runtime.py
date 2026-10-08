#!/usr/bin/env python3
"""Linux integration checks using real QML/hooks and a private notification bus.

Run: python3 tools/test-runtime.py
Needs a Wayland desktop, qs, socat, jq, bwrap, dbus-run-session, and Python gi.
All test data is under /tmp; bubblewrap masks the user's home and disables
networking. A second pet appears temporarily on the current desktop.
"""
import ctypes
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, timeout=10, **kwargs)


def wait_for(fn, description):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(0.05)
    raise AssertionError('Timed out: ' + description)


def inside(work):
    from gi.repository import Gio, GLib

    calls = []
    markup = True
    xml = '''<node><interface name="org.freedesktop.Notifications">
      <method name="GetCapabilities"><arg type="as" direction="out"/></method>
      <method name="Notify">
        <arg type="s" direction="in"/><arg type="u" direction="in"/>
        <arg type="s" direction="in"/><arg type="s" direction="in"/>
        <arg type="s" direction="in"/><arg type="as" direction="in"/>
        <arg type="a{sv}" direction="in"/><arg type="i" direction="in"/>
        <arg type="u" direction="out"/>
      </method>
    </interface></node>'''
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
                  'org.freedesktop.DBus', 'RequestName',
                  GLib.Variant('(su)', ('org.freedesktop.Notifications', 0)),
                  GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 5000, None)

    def method(conn, sender, path, iface, name, params, invocation):
        if name == 'GetCapabilities':
            invocation.return_value(GLib.Variant('(as)', (['body-markup'] if markup else [],)))
        else:
            calls.append(params.unpack())
            invocation.return_value(GLib.Variant('(u)', (len(calls),)))

    info = Gio.DBusNodeInfo.new_for_xml(xml)
    registration = bus.register_object('/org/freedesktop/Notifications', info.interfaces[0], method, None, None)
    loop = GLib.MainLoop()
    thread = threading.Thread(target=loop.run, daemon=True)
    thread.start()
    proc = None
    try:
        body = '<b>hello & "world"</b> \'你好\''
        payload = {'summary': 'project <name>', 'body': body}
        helper = str(ROOT / 'bin/agent-pet-notify')
        result = run([helper], input=json.dumps(payload))
        assert result.returncode == 0, result.stderr
        assert calls[-1][3] == payload['summary']
        assert calls[-1][4] == '&lt;b&gt;hello &amp; &quot;world&quot;&lt;/b&gt; &apos;你好&apos;', calls[-1]
        markup = False
        assert run([helper], input=json.dumps(payload)).returncode == 0
        assert calls[-1][4] == body
        for invalid in ['{', '[]', 'null']:
            assert run([helper], input=invalid).returncode == 2
        assert run([sys.executable, '-S', helper], input='{}').returncode == 3
        print('PASS notification helper: markup/plain text, exit 2, exit 3', flush=True)
        markup = True
        calls.clear()

        # Mock only external desktop/collector commands, keeping the real hook,
        # socat, helper, Service.qml, and remaining QML components in use.
        mockbin = work / 'bin'
        mockbin.mkdir()
        mocks = {
            'hyprctl': '#!/usr/bin/env python3\nimport os\nprint(os.environ.get("TEST_ACTIVE_WINDOW", "{}"))\n',
            'omarchy-agent-usage-update': '#!/bin/sh\nexit 0\n',
            'notify-send': '#!/usr/bin/env python3\nimport json,os,sys\nwith open(os.environ["TEST_FIXED_LOG"], "a") as f: f.write(json.dumps(sys.argv[1:])+"\\n")\n',
        }
        # Record actual executable arguments, then run the original utility.
        # Input remains on stdin; the recorder never copies it into argv.
        for utility in ['jq', 'socat', 'python3']:
            mocks[utility] = ('#!/usr/bin/python3\nimport json,os,sys\n'
                'with open(os.environ["TEST_ARGV_LOG"], "a") as f: f.write(json.dumps(sys.argv)+"\\n")\n'
                'os.execv("/usr/bin/' + utility + '", ["/usr/bin/' + utility + '", *sys.argv[1:]])\n')
        for name, content in mocks.items():
            p = mockbin / name
            p.write_text(content)
            p.chmod(0o755)
        env = dict(os.environ, PATH=str(mockbin) + ':' + os.environ['PATH'],
                   QT_QPA_PLATFORM='wayland', QT_QUICK_BACKEND='software',
                   QT_QPA_PLATFORMTHEME='', QT_ACCESSIBILITY='0',
                   NO_AT_BRIDGE='1', GIO_USE_VFS='local',
                   TEST_ARGV_LOG=str(work / 'argv.jsonl'),
                   TEST_FIXED_LOG=str(work / 'fixed.jsonl'))
        env.pop('AGENT_PET_INTERNAL', None)
        # Prevent the initial usage refresh without disabling event acceptance.
        usage = Path.home() / '.local/state/omarchy/agents/usage'
        usage.mkdir(parents=True)
        for agent in ['claude', 'codex']:
            (usage / (agent + '.json')).write_text(json.dumps({'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'windows': []}))
        config = Path.home() / '.config/agent-pet'
        config.mkdir(parents=True)
        (config / 'config.jsonc').write_text(json.dumps({'language': 'en', 'stepSummary': {'mode': 'off'}, 'whisperAuto': False}))
        with (work / 'qml.log').open('w') as log:
            proc = subprocess.Popen(['qs', '-p', str(ROOT), '--no-color'], env=env, stdout=log, stderr=log)
        sock = Path(env['XDG_RUNTIME_DIR']) / 'agent-pet/events.sock'
        def socket_ready():
            if proc.poll() is not None:
                raise AssertionError((work / 'qml.log').read_text())
            return sock.is_socket()
        wait_for(socket_ready, 'QML socket')
        assert sock.parent.stat().st_mode & 0o777 == 0o700

        def state():
            r = run(['qs', 'ipc', '--pid', str(proc.pid), 'call', 'agent-pet', 'state'], env=env)
            return json.loads(r.stdout) if r.returncode == 0 else None

        s = wait_for(state, 'IPC ready')
        assert s['ready'] and not s['configError'] and s['pets'], s
        hook = str(ROOT / 'bin/agent-pet-hook')

        def send(agent, session, event, hookenv=None, **extra):
            payload = dict(hook_event_name=event, session_id=session, cwd='/tmp/test-project', **extra)
            result = run([hook, agent], input=json.dumps(payload), env=hookenv or env)
            assert result.returncode == 0 and not result.stdout and not result.stderr, result

        def entry(agent, session, status):
            def check():
                s = state()
                item = s and s['sessions'].get(agent + ':' + session)
                return item if item and item['state'] == status else None
            return wait_for(check, session + ':' + status)

        for agent in ['claude', 'codex']:
            send(agent, agent, 'UserPromptSubmit', prompt='integration request')
            assert entry(agent, agent, 'thinking')['prompt'] == 'integration request'
            send(agent, agent, 'PreToolUse', tool_name='Bash', tool_input={'command': 'printf test'})
            assert entry(agent, agent, 'working')['detail'] == 'printf test'
        print('PASS actual standalone QML: hook -> socket -> state for Claude and Codex', flush=True)

        # A spaced/parenthesized comm must be crossed before reaching the focused
        # grandparent. Matching the renamed process itself would not test parsing.
        original = Path('/proc/self/comm').read_text().strip()
        assert ctypes.CDLL(None).prctl(15, b'pet ) parent', 0, 0, 0) == 0
        try:
            focused_env = dict(env, TEST_ACTIVE_WINDOW=json.dumps({'pid': os.getppid()}))
            send('claude', 'spaced-parent', 'UserPromptSubmit', hookenv=focused_env)
            assert entry('claude', 'spaced-parent', 'thinking')['focused'] is True
        finally:
            ctypes.CDLL(None).prctl(15, original.encode(), 0, 0, 0)
        for pid in ['not-a-pid', '1; touch /tmp/unwanted']:
            send('claude', 'bad-pid', 'UserPromptSubmit', hookenv=dict(env, TEST_ACTIVE_WINDOW=json.dumps({'pid': pid})))
            assert entry('claude', 'bad-pid', 'thinking')['focused'] is False
        print('PASS parent chain: spaces/parentheses and invalid active-window PID', flush=True)

        # Go beyond the recycling threshold and verify that accepting new events
        # still works, with no PeerClosedError spam from normal hook deliveries.
        for i in range(505):
            send('claude', 'recycle', 'PreToolUse', tool_name='Bash', tool_input={'command': 'step-' + str(i)})
            wait_for(lambda: (state()['sessions'].get('claude:recycle') or {}).get('detail') == 'step-' + str(i), 'recycle delivery')
        print('PASS socket recycling: 505 sequential hook deliveries', flush=True)

        for i in range(3):
            send('claude', 'notification-' + str(i), 'PermissionRequest', message=body)
        wait_for(lambda: len(calls) == 3, 'notification queue')
        assert all('test-project' in c[3] and c[4] == GLib.markup_escape_text(body) for c in calls), calls
        assert not (work / 'fixed.jsonl').exists(), 'Successful D-Bus incorrectly fell back'
        print('PASS Service.qml notification queue: 3 full D-Bus messages, no fallback', flush=True)

        private = 'PRIVATE-CONTENT-SENTINEL'
        send('codex', 'private-hook', 'UserPromptSubmit', prompt=private)
        assert entry('codex', 'private-hook', 'thinking')['prompt'] == private
        send('codex', 'private-hook', 'PreToolUse', tool_name='Bash', tool_input={'command': private})
        assert entry('codex', 'private-hook', 'working')['detail'] == private
        send('codex', 'private-hook', 'Stop', last_assistant_message=private, message=private)
        wait_for(lambda: len(calls) == 4, 'private notification')
        assert calls[-1][4] == private
        assert private not in (work / 'argv.jsonl').read_text()
        assert body not in (work / 'argv.jsonl').read_text()
        print('PASS hook/notification argv: prompt, tool input, final reply and message stay out', flush=True)

        # Hide gi from helper children to exercise the real QML exit-3 fallback.
        (mockbin / 'python3').write_text('#!/bin/sh\nexec /usr/bin/python3 -S "$@"\n')
        (mockbin / 'python3').chmod(0o755)
        for i in range(3, 6):
            send('claude', 'notification-' + str(i), 'PermissionRequest', message=body)
        fixed = work / 'fixed.jsonl'
        wait_for(lambda: fixed.exists() and len(fixed.read_text().splitlines()) == 3, 'fixed notification fallback')
        assert len(calls) == 4
        assert 'test-project' not in fixed.read_text() and 'hello' not in fixed.read_text()
        print('PASS Service.qml exit-3 fallback: 3 fixed messages without private content', flush=True)
        logs = (work / 'qml.log').read_text()
        for unexpected in ['PeerClosedError', 'ReferenceError', 'TypeError', 'Failed to load configuration', 'is not a type']:
            assert unexpected not in logs, logs
        print('PASS QML logs: no load/runtime errors or socket peer-close warnings', flush=True)
        (work / 'state.json').write_text(json.dumps(state(), indent=2))
        proc.terminate()
        proc.wait(timeout=5)
        proc = None
        check_chat(work, env)
        check_automation(work, env, calls)
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        bus.unregister_object(registration)
        loop.quit()
        thread.join(timeout=2)


def check_chat(work, env):
    """Invoke the same in-process requestChat as ChatInput, without text in IPC."""
    mock = '''#!/usr/bin/python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
record = {"argv": args, "input": sys.stdin.read(), "internal": os.environ.get("AGENT_PET_INTERNAL")}
if "--system-prompt-file" in args:
    p = Path(args[args.index("--system-prompt-file") + 1])
    record["system"] = p.read_text()
    record["dirMode"] = p.parent.stat().st_mode & 0o777
with open(os.environ["TEST_CHAT_LOG"], "a") as f: f.write(json.dumps(record) + "\\n")
print('{"text":"PRIVATE-REPLY-SENTINEL", "meme":"../../invalid"}')
'''
    for provider in ['claude', 'codex']:
        p = work / 'bin' / provider
        p.write_text(mock)
        p.chmod(0o755)
    fixture = work / 'chat-fixture'
    fixture.mkdir()
    (fixture / 'Commons').symlink_to(ROOT / 'Commons')
    # This harness adds a no-argument test trigger around the production Service.
    (fixture / 'shell.qml').write_text('''import Quickshell
import Quickshell.Io
import "''' + ROOT.as_uri() + '''" as Pet
ShellRoot {
  Pet.Service { id: service }
  FileView { id: input; path: "''' + str(work / 'chat-input.json') + '''"; blockAllReads: true }
  IpcHandler {
    target: "runtime-test"
    function chat(): string {
      input.reload()
      return service.requestChat("", JSON.parse(input.text()).text)
    }
    function webchat(): string {
      input.reload()
      return service.requestChat("", JSON.parse(input.text()).text, true)
    }
  }
}
''')
    chatlog = work / 'chat.jsonl'
    env = dict(env, TEST_CHAT_LOG=str(chatlog))
    cfg = Path.home() / '.config/agent-pet/config.jsonc'
    for provider in ['claude', 'codex']:
        cfg.write_text(json.dumps({'language': 'en', 'whisperPrompt': 'PRIVATE-SYSTEM-SENTINEL',
                                  'llm': {'provider': provider, 'codexModel': '', 'claudeModel': ''}}))
        (work / 'chat-input.json').write_text(json.dumps({'text': 'PRIVATE-FIRST-SENTINEL'}))
        with (work / ('chat-' + provider + '.log')).open('w') as log:
            proc = subprocess.Popen(['qs', '-p', str(fixture), '--no-color'], env=env, stdout=log, stderr=log)
        try:
            def state():
                r = run(['qs', 'ipc', '--pid', str(proc.pid), 'call', 'agent-pet', 'state'], env=env)
                return json.loads(r.stdout) if r.returncode == 0 else None
            wait_for(lambda: (state() or {}).get('ready'), 'chat fixture ready')
            for message in ['PRIVATE-FIRST-SENTINEL', 'PRIVATE-SECOND-SENTINEL']:
                (work / 'chat-input.json').write_text(json.dumps({'text': message}))
                result = run(['qs', 'ipc', '--pid', str(proc.pid), 'call', 'runtime-test', 'chat'], env=env)
                assert result.returncode == 0 and result.stdout.strip() == 'ok', result
                wait_for(lambda: not state()['llmBusy'], 'mock CLI finished')
            records = [json.loads(line) for line in chatlog.read_text().splitlines()][-2:]
            for record in records:
                assert 'PRIVATE-' not in json.dumps(record['argv']), record
                assert record['internal'] == '1'
            assert 'PRIVATE-FIRST-SENTINEL' in records[1]['input']
            assert 'PRIVATE-SECOND-SENTINEL' in records[1]['input']
            assert 'PRIVATE-REPLY-SENTINEL' in records[1]['input']
            if provider == 'claude':
                assert 'PRIVATE-SYSTEM-SENTINEL' in records[1]['system']
                assert records[1]['dirMode'] == 0o700
            else:
                assert 'PRIVATE-SYSTEM-SENTINEL' in records[1]['input']
                assert '--ignore-user-config' in records[1]['argv']
            print('PASS ' + provider + ' chat: current message/history/system prompt absent from argv', flush=True)

            # Web chat: only web tools opened, no chat history in the request
            (work / 'chat-input.json').write_text(json.dumps({'text': 'PRIVATE-WEB-SENTINEL'}))
            result = run(['qs', 'ipc', '--pid', str(proc.pid), 'call', 'runtime-test', 'webchat'], env=env)
            assert result.returncode == 0 and result.stdout.strip() == 'ok', result
            wait_for(lambda: not state()['llmBusy'], 'mock web CLI finished')
            web = json.loads(chatlog.read_text().splitlines()[-1])
            assert 'PRIVATE-' not in json.dumps(web['argv']), web
            assert 'PRIVATE-WEB-SENTINEL' in web['input']
            assert 'PRIVATE-FIRST-SENTINEL' not in web['input'] and 'PRIVATE-REPLY-SENTINEL' not in web['input'], web
            if provider == 'claude':
                i = web['argv'].index('--tools')
                assert web['argv'][i + 1] == 'WebSearch,WebFetch' and 'WebSearch,WebFetch' in web['argv'][i + 2:i + 4], web
                assert records[1]['argv'][records[1]['argv'].index('--tools') + 1] == ''
            else:
                assert 'web_search="live"' in web['argv'] and 'web_search="disabled"' in records[1]['argv'], web
            print('PASS ' + provider + ' web chat: web tools only, no history', flush=True)
        finally:
            proc.terminate()
            proc.wait(timeout=5)


def check_automation(work, env, calls):
    """Tasks, rules and the chime through the production Service, observing speak/play signals."""
    probe = work / 'bin' / 'automation-probe'
    probe.write_text("""#!/usr/bin/python3
import json, os, sys
record = {"argv": sys.argv[1:], "input": sys.stdin.read(), "cwd": os.getcwd(),
          "internal": os.environ.get("AGENT_PET_INTERNAL")}
with open(os.environ["TEST_AUTOMATION_LOG"], "a") as f: f.write(json.dumps(record) + "\\n")
print("probe-" + sys.argv[1])
""")
    probe.chmod(0o755)
    fixture = work / 'automation-fixture'
    fixture.mkdir()
    (fixture / 'Commons').symlink_to(ROOT / 'Commons')
    (fixture / 'shell.qml').write_text('''import Quickshell
import Quickshell.Io
import "''' + ROOT.as_uri() + '''" as Pet
ShellRoot {
  id: shellRoot
  property var spokenLog: []
  property var playedLog: []
  Pet.Service {
    id: service
    onSpeak: (petId, text, meme, kind) => shellRoot.spokenLog = shellRoot.spokenLog.concat([{ pet: petId, text: text, kind: kind }])
    onPlayRequest: (petId, name) => shellRoot.playedLog = shellRoot.playedLog.concat([name])
  }
  IpcHandler {
    target: "runtime-test"
    function spoken(): string { return JSON.stringify(shellRoot.spokenLog) }
    function played(): string { return JSON.stringify(shellRoot.playedLog) }
  }
}
''')
    log = work / 'automation.jsonl'
    env = dict(env, TEST_AUTOMATION_LOG=str(log))
    Path('/tmp/test-project').mkdir(exist_ok=True)
    cfg = Path.home() / '.config/agent-pet/config.jsonc'
    cfg.write_text(json.dumps({'language': 'zh', 'automations': {
        'chime': {'enabled': True, 'from': 0, 'to': 23, 'anims': {'*': ['写代码']}, 'quietWhenBusy': False},
        'tasks': [
            {'name': 'probe', 'every': 3600, 'run': [str(probe), 'task'], 'say': '结果 {output} / {exit}', 'when': 'always'},
            {'name': 'remind', 'at': '03:00', 'say': '提醒', 'play': '吃午餐'},
            {'name': 'slow', 'every': 3600, 'run': 'sleep 100', 'timeoutSec': 1, 'say': 'slow {exit}', 'when': 'always'},
        ],
        'rules': [
            {'name': 'commit', 'event': 'PostToolUse', 'tool': 'Bash', 'detail': '^git commit',
             'run': [str(probe), 'rule'], 'say': '{project} 提交 {output}', 'play': '放烟花', 'cooldownSec': 60},
            {'name': 'done', 'event': 'Stop', 'agent': 'codex', 'say': '{agentName} 完成'},
            {'name': 'broken', 'event': 'Stop', 'detail': '('},
        ],
    }}))
    # Reminder chat: the mock CLI answers with structured reminder actions.
    remind_mock = work / 'bin' / 'claude'
    remind_mock.write_text("""#!/usr/bin/python3
import json, os, sys
args = sys.argv[1:]
system = open(args[args.index("--system-prompt-file") + 1]).read()
path = os.environ["TEST_REMIND_LOG"]
with open(path, "a") as f: f.write(json.dumps({"system": system, "input": sys.stdin.read()}) + "\\n")
n = len(open(path).read().splitlines())
if n == 1:
    print(json.dumps({"text": "好哒", "meme": "", "reminders": [
        {"type": "add", "text": "喝水", "in_minutes": 0.05},
        {"type": "add", "text": "x", "at": "2000-01-01 00:00"}]}))
else:
    # Raw newline inside the JSON string, as models sometimes emit for multi-paragraph replies
    print('{"text": "给你看' + chr(10) + '第二段", "meme": "", "reminders": [{"type": "list"}]}')
""")
    remind_mock.chmod(0o755)
    env = dict(env, TEST_REMIND_LOG=str(work / 'remind.jsonl'))
    state_dir = Path.home() / '.local/state/agent-pet'
    reminders_file = state_dir / 'reminders.json'
    reminders_file.write_text(json.dumps([{'id': 'old', 'text': '旧提醒', 'due': int(time.time() * 1000) - 600000,
                                           'repeat': 'none', 'h': 0, 'm': 0}]))
    # An earlier check hid gi from python3; restore it so reminders use the D-Bus path
    (work / 'bin' / 'python3').write_text('#!/bin/sh\nexec /usr/bin/python3 "$@"\n')
    notified = len(calls)
    with (work / 'automation.log').open('w') as qlog:
        proc = subprocess.Popen(['qs', '-p', str(fixture), '--no-color'], env=env, stdout=qlog, stderr=qlog)
    try:
        def call(target, method, *args):
            r = run(['qs', 'ipc', '--pid', str(proc.pid), 'call', target, method, *args], env=env)
            return r.stdout.strip() if r.returncode == 0 else None
        def state():
            out = call('agent-pet', 'state')
            return json.loads(out) if out else None
        def spoken():
            return json.loads(call('runtime-test', 'spoken') or '[]')
        def records():
            return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        s = wait_for(lambda: (state() or {}).get('ready') and state(), 'automation fixture ready')
        auto = s['automations']
        assert auto['chime'] and auto['tasks'] == ['probe', 'remind', 'slow'] and auto['rules'] == ['commit', 'done'], auto
        assert any('broken' in e for e in auto['errors']), auto

        # every task: runs once on start, then manually through IPC
        wait_for(lambda: any(x['text'] == '结果 probe-task / 0' for x in spoken()), 'task on start')
        assert call('agent-pet', 'task', 'probe') == 'ok'
        wait_for(lambda: len([r for r in records() if r['argv'] == ['task']]) == 2, 'manual task')
        assert all(r['internal'] == '1' for r in records())
        assert call('agent-pet', 'task', 'missing') == 'no-task'
        assert call('agent-pet', 'task', 'remind') == 'ok'
        wait_for(lambda: any(x['text'] == '提醒' for x in spoken()), 'reminder')
        # timeout: SIGTERM after 1 s, exit code is reported
        wait_for(lambda: any(x['text'].startswith('slow ') for x in spoken()), 'task timeout')
        assert not state()['automations']['running']
        print('PASS automation tasks: start/manual/at reminder/timeout, AGENT_PET_INTERNAL set', flush=True)

        hook = str(ROOT / 'bin/agent-pet-hook')
        def send(agent, event, **extra):
            payload = dict(hook_event_name=event, session_id='auto', cwd='/tmp/test-project', **extra)
            assert run([hook, agent], input=json.dumps(payload), env=env).returncode == 0
        private = 'PRIVATE-AUTOMATION-SENTINEL'
        send('claude', 'PostToolUse', tool_name='Bash', tool_input={'command': 'git status'})
        send('claude', 'PostToolUse', tool_name='Bash', tool_input={'command': 'git commit -m ' + private})
        wait_for(lambda: any(x['text'] == 'test-project 提交 probe-rule' for x in spoken()), 'rule fired')
        send('claude', 'PostToolUse', tool_name='Bash', tool_input={'command': 'git commit -m again'})
        send('codex', 'Stop', last_assistant_message='bye')
        wait_for(lambda: any(x['text'] == 'Codex 完成' for x in spoken()), 'say-only rule')
        rule_runs = [r for r in records() if r['argv'] == ['rule']]
        assert len(rule_runs) == 1, rule_runs  # git status no match, second commit in cooldown
        assert private in rule_runs[0]['input'] and private not in json.dumps(rule_runs[0]['argv'])
        assert json.loads(rule_runs[0]['input'])['event'] == 'PostToolUse'
        assert rule_runs[0]['cwd'] == '/tmp/test-project'
        assert '放烟花' in json.loads(call('runtime-test', 'played'))
        print('PASS automation rules: match/cooldown/stdin event/cwd/say-only', flush=True)

        assert call('agent-pet', 'chime') == 'ok'
        wait_for(lambda: any(x['text'].endswith('点啦～') for x in spoken()), 'chime')
        assert '写代码' in json.loads(call('runtime-test', 'played'))
        print('PASS automation chime via IPC', flush=True)

        # Missed while the shell was off: fired once on start, marked late
        assert any(x['text'] == '⏰ 旧提醒（迟到了）' and x['kind'] == 'reminder' for x in spoken()), spoken()
        assert call('agent-pet', 'chat', '3秒后提醒我喝水') == 'ok'
        reply = wait_for(lambda: next((x for x in spoken() if x['text'].startswith('好哒')), None), 'reminder reply')
        assert reply['text'].split('\n')[1].startswith('⏰ ') and reply['text'].endswith('喝水\n这个时间已经过了哦'), reply
        assert json.loads(call('agent-pet', 'reminders'))[0]['text'] == '喝水'
        assert json.loads(reminders_file.read_text())[0]['text'] == '喝水'
        wait_for(lambda: any(x['text'] == '⏰ 喝水' and x['kind'] == 'reminder' for x in spoken()), 'reminder fired')
        wait_for(lambda: json.loads(reminders_file.read_text()) == [], 'fired reminder removed')
        wait_for(lambda: not state()['llmBusy'], 'chat idle')
        assert call('agent-pet', 'chat', '我的提醒') == 'ok'
        wait_for(lambda: any(x['text'] == '给你看\n第二段\n现在没有提醒' for x in spoken()), 'list reply (raw newline JSON)')
        prompts = [json.loads(line) for line in (work / 'remind.jsonl').read_text().splitlines()]
        assert '当前提醒：无' in prompts[0]['system'] and '"reminders"' in prompts[0]['system'], prompts[0]
        reminder_calls = lambda: [(c[3], c[4]) for c in calls[notified:] if c[3] == '提醒']
        wait_for(lambda: len(reminder_calls()) >= 2, 'reminder notifications')
        assert reminder_calls() == [('提醒', '旧提醒'), ('提醒', '喝水')], calls[notified:]
        print('PASS reminders: chat actions/validation/fire/notify/persist/late on start', flush=True)
        logs = (work / 'automation.log').read_text()
        for unexpected in ['ReferenceError', 'TypeError', 'is not a type', 'is not a function']:
            assert unexpected not in logs, logs
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--inside':
        inside(Path(sys.argv[2]))
        return
    work = Path(tempfile.mkdtemp(prefix='agent-pet-runtime-'))
    fakehome = work / 'home'
    fakehome.mkdir()
    # Keep HOME unchanged; replace the home mount inside the test namespace.
    (fakehome / ROOT.relative_to(Path.home())).mkdir(parents=True)
    runtime = work / 'runtime'
    runtime.mkdir(mode=0o700)
    # No activation directories: don't start portals or other desktop services.
    busconfig = work / 'bus.conf'
    busconfig.write_text('''<busconfig><type>session</type>
      <listen>unix:tmpdir=/tmp</listen><auth>EXTERNAL</auth>
      <policy context="default"><allow send_destination="*"/>
        <allow receive_sender="*"/><allow own="*"/></policy>
      </busconfig>''')
    display = Path(os.environ['WAYLAND_DISPLAY'])
    if not display.is_absolute():
        display = Path(os.environ['XDG_RUNTIME_DIR']) / display
    command = ['bwrap', '--die-with-parent', '--unshare-net', '--ro-bind', '/', '/',
               '--dev-bind', '/dev', '/dev',
               '--bind', '/tmp', '/tmp', '--bind', str(fakehome), str(Path.home()),
               '--ro-bind', str(ROOT), str(ROOT), '--setenv', 'XDG_RUNTIME_DIR', str(runtime),
               '--setenv', 'WAYLAND_DISPLAY', str(display),
               '--setenv', 'XDG_CONFIG_HOME', str(Path.home() / '.config'),
               '--setenv', 'XDG_CACHE_HOME', str(fakehome / '.cache'),
               'dbus-run-session', '--config-file=' + str(busconfig), '--',
               sys.executable, str(Path(__file__).resolve()), '--inside', str(work)]
    print('Test artifacts: ' + str(work), flush=True)
    raise SystemExit(subprocess.call(command))


if __name__ == '__main__':
    main()
