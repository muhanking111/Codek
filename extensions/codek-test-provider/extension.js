/**
 * Codek Test Provider Extension — registers a completion provider to verify W3.
 */
const vscode = require('vscode');

function activate(context) {
    console.log('[codek-test-provider] Activating...');

    // Register a simple completion provider for TypeScript/JavaScript
    const provider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: 'typescript' },
        {
            provideCompletionItems(document, position, token, context) {
                const items = [];
                const trigger = context.triggerCharacter;

                // Simple test completions
                items.push(new vscode.CompletionItem('hello', vscode.CompletionItemKind.Keyword));
                items.push(new vscode.CompletionItem('world', vscode.CompletionItemKind.Text));

                const item = new vscode.CompletionItem('testCompletion', vscode.CompletionItemKind.Function);
                item.detail = 'Codek Test Provider';
                item.documentation = 'A test completion item from the Codek test provider extension';
                item.insertText = 'testCompletion(param: string): void';
                items.push(item);

                console.log(`[codek-test-provider] provideCompletionItems returned ${items.length} items`);
                return items;
            }
        },
        '.' // Trigger on dot
    );

    context.subscriptions.push(provider);

    // Also register a hover provider
    const hoverProvider = vscode.languages.registerHoverProvider(
        { scheme: 'file', language: 'typescript' },
        {
            provideHover(document, position, token) {
                return new vscode.Hover('**Codek Test Hover** — this is from the test extension.');
            }
        }
    );

    context.subscriptions.push(hoverProvider);

    console.log('[codek-test-provider] Activated with completion + hover providers');
}

function deactivate() {
    console.log('[codek-test-provider] Deactivating');
}

module.exports = { activate, deactivate };
