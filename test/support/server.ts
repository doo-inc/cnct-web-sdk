import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket as NodeWebSocket } from 'ws';

/**
 * Enough of CNCT to hold this SDK to its contract.
 *
 * Deliberately not a mock of `fetch`: the thing worth testing here is the whole path — a real socket
 * upgrade, real JSON, real status codes, real `x-chat-token` — because every bug this SDK has had was
 * in the seam between those, and a stubbed `fetch` is exactly the seam a stub cannot fail at.
 */
export interface MockCnct {
  baseUrl: string;
  /** Every request the SDK made, in order. Assert on headers here. */
  requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[];
  /** Push a message to every connected visitor socket, as an operator reply would. */
  push(frame: unknown): void;
  /** Answer the next call to this path with a status and body. */
  stub(key: string, response: { status: number; body: unknown }): void;
  /** What the socket advertises on the handshake. Empty means "this server has no socket sends". */
  accepts: string[];
  /** Set false to make the socket refuse the token with 1008. */
  acceptToken: boolean;
  sockets: NodeWebSocket[];
  /** Every file uploaded, as the server parsed it out of the multipart body. */
  uploads: { id: string; field: string; filename: string; type: string; bytes: Uint8Array }[];
  /** What `boot()` answers with, beyond the basics. Replace to test a different inbox. */
  inbox: Record<string, unknown>;
  close(): Promise<void>;
}

const TOKEN = 'visitor-token-abc';
/** What `identify` hands back: a different token, so a test can see the old one was replaced. */
export const SIGNED_IN_TOKEN = 'signed-in-token-xyz';
/** The inbox's identity secret, which in real life lives only on the business's server. */
export const IDENTITY_SECRET = 'the-inbox-identity-secret';
export const signUser = (userId: string) =>
  createHmac('sha256', IDENTITY_SECRET).update(userId).digest('hex');

export async function startMockCnct(options: { prefix?: string } = {}): Promise<MockCnct> {
  const prefix = options.prefix ?? '';
  const requests: MockCnct['requests'] = [];
  const stubs = new Map<string, { status: number; body: unknown }>();
  const sockets: NodeWebSocket[] = [];
  const messages: Record<string, unknown>[] = [];
  const uploads: MockCnct['uploads'] = [];
  const tokens = new Set([TOKEN]);
  let conversationNumber = 1;
  const conversation = () => ({
    id: `conv_${conversationNumber}`,
    status: 'OPEN',
    startedAt: '2026-09-19T08:00:00.000Z',
    withPerson: false,
  });
  const inbox: { value: Record<string, unknown> } = {
    value: {
      widget: { brand: { color: '#123456', language: 'ar' }, chat: { start: 'message' } },
      team: [{ kind: 'person', name: 'Sara', avatar: 'fox-clay', secret: 'never published' }],
      availability: {
        open: false,
        opensAt: '2026-09-20T05:00:00.000Z',
        assistant: true,
        replyMinutes: null,
      },
    },
  };
  const store = (input: { body: string; clientKey?: string; attachmentIds?: string[] }) => {
    const stored = {
      id: `msg_${messages.length + 1}`,
      speaker: 'CALLER',
      sender: null,
      type: 'TEXT',
      body: input.body,
      createdAt: new Date(Date.now() + messages.length).toISOString(),
      clientKey: input.clientKey ?? null,
      attachments: (input.attachmentIds ?? [])
        .map((id) => uploads.find((upload) => upload.id === id))
        .filter(Boolean)
        .map((upload) => ({
          id: upload!.id,
          kind: upload!.type.startsWith('image/') ? 'IMAGE' : 'FILE',
          mimeType: upload!.type,
          filename: upload!.filename,
          bytes: upload!.bytes.length,
        })),
    };
    messages.push(stored);
    return stored;
  };

  const state = {
    accepts: ['ping', 'typing', 'send'] as string[],
    acceptToken: true,
  };
  const closed = { value: false };

  const server: Server = createServer((request, response) => {
    void handle(request, response);
  });

  const json = (response: ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(text);
  };

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
    const bytes = await readBody(request);
    const raw = bytes.toString('utf8');
    const multipart = String(request.headers['content-type'] ?? '').startsWith('multipart/');
    const body = raw && !multipart ? safeParse(raw) : undefined;
    requests.push({
      method: request.method ?? 'GET',
      path: url.pathname + (url.search || ''),
      headers: request.headers as Record<string, string>,
      body,
    });

    const stubbed = stubs.get(`${request.method} ${path}`);
    if (stubbed) {
      stubs.delete(`${request.method} ${path}`);
      return json(response, stubbed.status, stubbed.body);
    }

    const token = request.headers['x-chat-token'];
    const authorized = typeof token === 'string' && tokens.has(token);

    // ── Chat ───────────────────────────────────────────────────────────────────────────────────
    if (request.method === 'GET' && path === '/api/chat/public/session') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      return json(response, 200, {
        visitor: { displayName: 'Layla' },
        conversation: conversation(),
        messages: messages.slice(),
      });
    }
    if (request.method === 'GET' && path === '/api/chat/public/conversations') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      return json(response, 200, {
        visitor: { displayName: 'Layla', anonymous: false },
        conversations: [{ ...conversation(), preview: messages.at(-1) ?? null }],
      });
    }
    {
      const match = /^\/api\/chat\/public\/conversations\/([^/]+)(\/read|\/rating)?$/.exec(path);
      if (match) {
        if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
        const id = decodeURIComponent(match[1]);
        if (request.method === 'GET' && !match[2]) {
          return json(response, 200, {
            visitor: { displayName: 'Layla' },
            conversation: { ...conversation(), id },
            messages: messages.slice(),
          });
        }
        if (request.method === 'POST' && match[2] === '/read') {
          response.writeHead(204);
          return response.end();
        }
        if (request.method === 'POST' && match[2] === '/rating') {
          const input = body as { score: number; comment?: string };
          return json(response, 200, {
            conversation: {
              ...conversation(),
              id,
              status: 'CLOSED',
              ratable: true,
              rating: {
                score: input.score,
                comment: input.comment ?? null,
                ratedAt: new Date().toISOString(),
              },
            },
          });
        }
      }
    }
    if (request.method === 'POST' && path === '/api/chat/public/profile') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      const input = body as { displayName: string };
      return json(response, 200, { visitor: { displayName: input.displayName, anonymous: false } });
    }
    if (request.method === 'POST' && path === '/api/chat/public/attachments') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      // Parsed by the platform's own rules for multipart rather than by string matching, so a
      // malformed body is refused here exactly as it would be there.
      const form = await new Response(new Uint8Array(bytes), {
        headers: { 'content-type': String(request.headers['content-type']) },
      })
        .formData()
        .catch(() => null);
      const file = form?.get('file');
      if (!form || !file || typeof file === 'string') {
        return json(response, 400, { error: 'Send one file, in a part named file.' });
      }
      const fields: string[] = [];
      form.forEach((_value, key) => fields.push(key));
      const upload = {
        id: `att_${uploads.length + 1}`,
        field: fields.join(','),
        filename: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      };
      uploads.push(upload);
      return json(response, 201, {
        attachment: {
          id: upload.id,
          kind: upload.type.startsWith('image/') ? 'IMAGE' : 'FILE',
          mimeType: upload.type,
          filename: upload.filename,
          bytes: upload.bytes.length,
        },
      });
    }
    if (request.method === 'POST' && /^\/api\/chat\/public\/[^/]+\/identify$/.test(path)) {
      const input = body as { userId?: string; userHash?: string };
      if (!input?.userId || input.userHash !== signUser(input.userId)) {
        return json(response, 401, { error: 'That signature did not verify.' });
      }
      tokens.add(SIGNED_IN_TOKEN);
      return json(response, 200, {
        token: SIGNED_IN_TOKEN,
        visitor: { displayName: 'Layla Signed', anonymous: false, identified: true },
      });
    }
    if (request.method === 'GET' && /^\/api\/chat\/public\/[^/]+$/.test(path)) {
      return json(response, 200, {
        business: 'Qimam Elevators',
        inbox: 'Website',
        isActive: true,
        greeting: 'How can we help?',
        requirePhone: false,
        ...inbox.value,
      });
    }
    if (request.method === 'POST' && /^\/api\/chat\/public\/[^/]+\/session$/.test(path)) {
      // A token for a conversation that is already closed starts a new one for the same visitor.
      if (authorized && closed.value) {
        conversationNumber += 1;
        closed.value = false;
        messages.length = 0;
      }
      return json(response, 200, {
        token: TOKEN,
        visitor: { displayName: (body as { displayName?: string })?.displayName ?? 'Visitor' },
        conversation: conversation(),
        messages: messages.slice(),
      });
    }
    if (request.method === 'POST' && path === '/api/chat/public/messages') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      const input = body as { body: string; clientKey?: string; attachmentIds?: string[] };
      if (!input.body && !input.attachmentIds?.length) {
        return json(response, 400, { error: 'Say something, or send a file.', code: 'invalid' });
      }
      // Idempotent, exactly as the platform is: the same clientKey returns the row it already wrote.
      const existing = messages.find((m) => m.clientKey && m.clientKey === input.clientKey);
      if (existing) return json(response, 200, existing);
      return json(response, 200, store(input));
    }
    if (request.method === 'POST' && path === '/api/chat/public/close') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      closed.value = true;
      return json(response, 200, { ok: true });
    }
    if (request.method === 'GET' && path.startsWith('/api/chat/public/attachments/')) {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      response.writeHead(200, { 'content-type': 'image/png' });
      return response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }

    // ── Bookings and tickets ───────────────────────────────────────────────────────────────────
    // Two keys, as the platform has two kinds: a sandbox key's every answer says `sandbox: true`.
    const sandbox = AGENT_KEYS[String(request.headers.authorization)];
    // Only `/api/tools`: the platform still answers `/api/booking-tools` too, but this SDK must not
    // be the thing that keeps the old address alive, so here it 404s.
    if (request.method === 'GET' && path === '/api/tools') {
      if (sandbox === undefined) return json(response, 401, { error: 'Unauthenticated' });
      return json(response, 200, {
        sandbox,
        tools: [
          { name: 'check_availability', description: 'Free times', parameters: { type: 'object' } },
        ],
        rules: {
          timezone: 'Asia/Bahrain',
          capacity: 40,
          slotMinutes: 30,
          services: [{ id: 'svc_1', name: 'Haircut', durationMinutes: 45 }],
          resources: [{ id: 'res_1', name: 'Layla', kind: 'PERSON', seats: 1 }],
          hours: { mon: '09:00-18:00' },
        },
      });
    }
    if (request.method === 'POST' && path.startsWith('/api/tools/')) {
      if (sandbox === undefined) return json(response, 401, { error: 'Unauthenticated' });
      const tool = decodeURIComponent(path.slice('/api/tools/'.length));
      const result = toolResult(tool, body as Record<string, unknown>);
      return json(response, 200, sandbox ? { ...result, sandbox: true } : result);
    }

    return json(response, 404, { error: 'Not found' });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.endsWith('/ws/chat')) return socket.destroy();
    wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.push(ws);
      ws.on('message', (data) => {
        const frame = safeParse(String(data)) as Record<string, unknown> | undefined;
        if (!frame) return;
        if (frame.type === 'auth') {
          if (!state.acceptToken || !tokens.has(String(frame.token))) {
            return ws.close(1008, 'Unauthenticated');
          }
          return ws.send(JSON.stringify({ type: 'authenticated', accepts: state.accepts }));
        }
        if (frame.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
        if (frame.type === 'send') {
          const stored = store(
            frame as { body: string; clientKey?: string; attachmentIds?: string[] },
          );
          return ws.send(JSON.stringify({ type: 'ack', id: frame.id, message: stored }));
        }
      });
      ws.on('close', () => {
        const at = sockets.indexOf(ws);
        if (at >= 0) sockets.splice(at, 1);
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}${prefix}`,
    requests,
    push: (frame) => {
      // A reply pushed is a reply stored, as on the platform — so a transcript refetched after it
      // still has it, and a test does not race the refetch the socket's handshake starts.
      const message = (frame as { type?: string; payload?: { message?: Record<string, unknown> } })
        .payload?.message;
      if ((frame as { type?: string }).type === 'chat.message' && message) messages.push(message);
      sockets.forEach((ws) => ws.send(JSON.stringify(frame)));
    },
    stub: (key, value) => void stubs.set(key, value),
    get accepts() {
      return state.accepts;
    },
    set accepts(value: string[]) {
      state.accepts = value;
    },
    get acceptToken() {
      return state.acceptToken;
    },
    set acceptToken(value: boolean) {
      state.acceptToken = value;
    },
    sockets,
    uploads,
    get inbox() {
      return inbox.value;
    },
    set inbox(value: Record<string, unknown>) {
      inbox.value = value;
    },
    close: async () => {
      sockets.forEach((ws) => ws.terminate());
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The keys this mock accepts on the booking tools, and whether each is a sandbox key. */
const AGENT_KEYS: Record<string, boolean> = {
  'Bearer kaer_sk_test': false,
  'Bearer kaer_sk_test_sandbox': true,
};

function toolResult(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (tool) {
    case 'check_availability':
      if (args.date === '2026-12-25') return { error: 'We are closed that day.' };
      return {
        date: args.date,
        free: [
          { time: '19:30', startsAt: '2026-09-20T16:30:00.000Z', with: 'Layla' },
          { time: '20:00', startsAt: '2026-09-20T17:00:00.000Z' },
        ],
        note: null,
      };
    case 'create_booking':
      return {
        bookingId: 'bk_1',
        when: 'Sunday 20 September at 19:30',
        name: args.name ?? null,
        partySize: args.partySize ?? null,
        with: 'Layla',
      };
    case 'find_my_booking':
      return {
        bookings: [{ bookingId: 'bk_1', when: 'Sunday 20 September at 19:30', partySize: 4 }],
      };
    case 'reschedule_booking':
      return { when: 'Monday 21 September at 19:30' };
    case 'cancel_booking':
      return { was: 'Sunday 20 September at 19:30' };
    case 'list_services':
      return { services: [{ serviceId: 'svc_1', name: 'Haircut', minutes: 45 }] };
    case 'list_people':
      return { people: [], note: 'This business assigns whoever is free.' };
    case 'list_ticket_types':
      return { types: [{ ticketTypeId: 'tt_1', name: 'Refund', description: 'Money back' }] };
    case 'get_ticket_type':
      return {
        ticketTypeId: 'tt_1',
        name: 'Refund',
        alreadyKnown: { customerPhone: '+97312345678' },
        askFor: [
          {
            key: 'orderNumber',
            required: true,
            question: 'What is the order number?',
            mustBeOneOf: [],
          },
        ],
      };
    case 'create_ticket':
      return { ticketNumber: 1042, note: 'Someone will pick this up.' };
    case 'find_my_tickets':
      return {
        tickets: [
          {
            ticketNumber: 1042,
            title: 'Refund not received',
            status: 'OPEN',
            raised: '2026-09-18',
          },
        ],
      };
    case 'get_ticket':
      if (args.ticketNumber !== 1042)
        return { error: `No ticket #${String(args.ticketNumber)} belongs to them.` };
      return {
        ticketNumber: 1042,
        title: 'Refund not received',
        kind: 'Refund',
        status: 'WAITING',
        waitingOnCustomer: true,
        raised: '2026-09-18',
        resolved: null,
        closed: null,
        customerRequest: 'My money back for order 881',
        desiredOutcome: null,
        details: [{ name: 'Order number', value: '881' }],
        history: [
          { on: '2026-09-18', what: 'Raised' },
          { on: '2026-09-19', what: 'Waiting on the customer' },
        ],
        note: 'This is waiting on the customer.',
      };
    case 'add_to_ticket':
      if (args.ticketNumber === 7)
        return { error: 'Not added. #7 is resolved, so nobody is working on it any more.' };
      return {
        ok: true,
        ticketNumber: args.ticketNumber,
        resumed: args.ticketNumber === 1042,
        note: 'Added.',
      };
    default:
      return { error: `Unknown tool ${tool}` };
  }
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
