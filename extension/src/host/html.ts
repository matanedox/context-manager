import * as fs from 'fs';
import * as vscode from 'vscode';

function nonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let s = '';
	for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
	return s;
}

export function webviewRoots(extensionUri: vscode.Uri): vscode.Uri[] {
	return [vscode.Uri.joinPath(extensionUri, 'webview'), vscode.Uri.joinPath(extensionUri, 'media')];
}

export function loadWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const htmlPath = vscode.Uri.joinPath(extensionUri, 'webview', 'index.html');
	const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'board.css'));
	const n = nonce();
	// Load order matters: each script uses the shared state the earlier ones declare.
	const scripts = [
		'shared/dom.js',
		'shared/sessions.js',
		'screens/team.js',
		'screens/agent-rules.js',
		'screens/agent-flow.js',
		'screens/agent-context-meter.js',
		'screens/agent.js',
		'screens/agent-events.js',
		'main.js',
	]
		.map((file) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', file)))
		.map((uri) => `<script nonce="${n}" src="${uri.toString()}"></script>`)
		.join('\n  ');
	return fs
		.readFileSync(htmlPath.fsPath, 'utf8')
		.replaceAll('{{cspSource}}', webview.cspSource)
		.replaceAll('{{nonce}}', n)
		.replaceAll('{{cssUri}}', css.toString())
		.replaceAll('{{scripts}}', scripts);
}
