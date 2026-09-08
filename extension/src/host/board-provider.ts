import * as vscode from "vscode";
import { ScrumBoard, VIEW_ID } from "./board";

export { VIEW_ID };

export class ScrumBoardProvider implements vscode.WebviewViewProvider {
  constructor(private readonly board: ScrumBoard) {}
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.board.attach(webviewView.webview, (title) => { webviewView.title = title; });
    webviewView.onDidDispose(() => this.board.detach(webviewView.webview));
  }
}
