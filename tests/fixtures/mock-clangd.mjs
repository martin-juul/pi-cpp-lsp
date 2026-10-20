// Minimal protocol peer: deliberately fragments frames and interleaves requests.
let buffer = Buffer.alloc(0);
const documents = new Map();
const cancellations = [];
let initialized = false;
let buildDir = process.argv.find(arg => arg.startsWith('--compile-commands-dir='));
function send(message) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  const frame = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  process.stdout.write(frame.subarray(0, 17));
  process.stdout.write(frame.subarray(17));
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === 'initialize') {
      if (process.argv.includes('init-hang')) continue;
      if (message.params.capabilities.general.positionEncodings[0] !== 'utf-16') process.exit(5);
      send({ id: message.id, result: { capabilities: { positionEncoding: 'utf-16' } } });
    } else if (message.method === 'initialized') {
      initialized = true;
      send({ id: 'server-request', method: 'workspace/configuration', params: { items: [{ section: 'clangd' }] } });
    } else if (message.method === '$/cancelRequest') cancellations.push(message.params.id);
    else if (message.method === 'textDocument/didClose') documents.delete(message.params.textDocument.uri);
    else if (message.method === 'textDocument/didOpen') documents.set(message.params.textDocument.uri, message.params.textDocument);
    else if (message.method === 'textDocument/didChange') {
      const doc = documents.get(message.params.textDocument.uri);
      doc.text = message.params.contentChanges[0].text;
      doc.version = message.params.textDocument.version;
    } else if (message.method === 'textDocument/hover' || message.method === 'textDocument/definition') {
      const doc = documents.get(message.params.textDocument.uri);
      if (!initialized || !doc) process.exit(6);
      if (doc.text.includes('CRASH')) process.exit(7);
      if (doc.text.includes('HANG')) continue;
      if (doc.text.includes('ERROR')) send({ id: message.id, error: { code: -32001, message: 'mock failure' } });
      else if (doc.text.includes('EMPTY')) send({ id: message.id, result: null });
      else if (message.method.endsWith('hover')) send({ id: message.id, result: { contents: { kind: 'markdown', value: JSON.stringify({ text: doc.text, version: doc.version, position: message.params.position, buildDir, cancellations }) } } });
      else send({ id: message.id, result: [{ targetUri: doc.uri, targetRange: { start: { line: 0, character: 0 }, end: { line: 2, character: 4 } }, targetSelectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } } }] });
    } else if (message.method === 'shutdown') send({ id: message.id, result: null });
    else if (message.method === 'exit') process.exit(0);
  }
});
