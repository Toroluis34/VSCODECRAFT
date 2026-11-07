import * as vscode from 'vscode';

export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('VSCodeCraft', { log: true });

  info(message: string, ...args: unknown[]): void {
    this.channel.info(message, ...args);
  }
  warn(message: string, ...args: unknown[]): void {
    this.channel.warn(message, ...args);
  }
  error(message: string | Error, ...args: unknown[]): void {
    this.channel.error(message instanceof Error ? (message.stack ?? message.message) : message, ...args);
  }
  debug(message: string, ...args: unknown[]): void {
    this.channel.debug(message, ...args);
  }
  show(): void {
    this.channel.show(true);
  }
  dispose(): void {
    this.channel.dispose();
  }
}
