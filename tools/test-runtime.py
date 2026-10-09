#!/usr/bin/env python3
"""Linux integration checks using real QML/hooks and a private session bus.

Run: python3 tools/test-runtime.py
Needs a Wayland desktop, qs, socat, jq, bwrap, and dbus-run-session.
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
    proc = None
    try:
        body = '<b>hello & "world"</b> \'你好\''

        # Mock only external desktop/collector commands, keeping the real hook,
        # socat, Service.qml, and remaining QML components in use.
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

        fixed = work / 'fixed.jsonl'
        def notifications(count):
            return lambda: fixed.exists() and len(fixed.read_text().splitlines()) == count
        for i in range(3):
            send('claude', 'notification-' + str(i), 'PermissionRequest', message=body)
        wait_for(notifications(3), 'notifications')
        sent = [json.loads(line) for line in fixed.read_text().splitlines()]
        assert all(args[-1] == 'Claude Code · Needs your approval' for args in sent), sent
        assert 'test-project' not in fixed.read_text() and 'hello' not in fixed.read_text()
        print('PASS Service.qml notifications: 3 fixed messages without project or message', flush=True)

        private = 'PRIVATE-CONTENT-SENTINEL'
        send('codex', 'private-hook', 'UserPromptSubmit', prompt=private)
        assert entry('codex', 'private-hook', 'thinking')['prompt'] == private
        send('codex', 'private-hook', 'PreToolUse', tool_name='Bash', tool_input={'command': private})
        assert entry('codex', 'private-hook', 'working')['detail'] == private
        send('codex', 'private-hook', 'Stop', last_assistant_message=private, message=private)
        wait_for(notifications(4), 'private notification')
        assert json.loads(fixed.read_text().splitlines()[-1])[-1] == 'Codex · Task complete'
        for log in [work / 'argv.jsonl', fixed]:
            assert private not in log.read_text() and body not in log.read_text()
        print('PASS hook/notification argv: prompt, tool input, final reply and message stay out', flush=True)
        logs = (work / 'qml.log').read_text()
        for unexpected in ['PeerClosedError', 'ReferenceError', 'TypeError', 'Failed to load configuration', 'is not a type']:
            assert unexpected not in logs, logs
        print('PASS QML logs: no load/runtime errors or socket peer-close warnings', flush=True)
        (work / 'state.json').write_text(json.dumps(state(), indent=2))
        proc.terminate()
        proc.wait(timeout=5)
        proc = None
        check_chat(work, env)
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


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
