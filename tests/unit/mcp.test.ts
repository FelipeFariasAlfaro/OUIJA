import { describe, expect, it } from 'vitest'
import { handleMcpMessage, type McpTool } from '../../src/main/mcp/server'
import { langFromLocale } from '../../src/shared/langs'

const echo: McpTool = {
  name: 'echo',
  title: 'Echo',
  description: 'Devuelve lo que recibe',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  run: async (a) => {
    if (a.text === 'boom') throw new Error('falló la herramienta')
    return { said: a.text }
  }
}

describe('servidor MCP', () => {
  it('se presenta y anuncia sus herramientas', async () => {
    const init = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, [echo], '1.2.3')
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'ouija', version: '1.2.3' }, capabilities: { tools: {} } } })
    const list = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, [echo], '1')
    expect(list).toMatchObject({ result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } })
    expect(JSON.stringify(list)).not.toContain('run')
  })
  it('las notificaciones no tienen respuesta', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, [echo], '1')).toBeNull()
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'algo/desconocido' }, [echo], '1')).toBeNull()
  })
  it('ejecuta herramientas y devuelve los errores como resultado, no como fallo del protocolo', async () => {
    const ok = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hola' } } }, [echo], '1')
    expect(ok).toMatchObject({ id: 3, result: { content: [{ type: 'text' }], structuredContent: { said: 'hola' } } })
    const bad = await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { text: 'boom' } } }, [echo], '1')
    expect(bad).toMatchObject({ id: 4, result: { isError: true, content: [{ text: 'falló la herramienta' }] } })
  })
  it('rechaza métodos, herramientas y mensajes inválidos con errores JSON-RPC', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'rm_rf' } }, [echo], '1')).toMatchObject({ error: { code: -32602 } })
    expect(await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, [echo], '1')).toMatchObject({ error: { code: -32601 } })
    expect(await handleMcpMessage(42, [echo], '1')).toMatchObject({ error: { code: -32600 } })
  })
})

describe('idiomas', () => {
  it('toma el idioma del sistema si OUIJA lo habla; si no, inglés', () => {
    expect(langFromLocale('pt-BR')).toBe('pt')
    expect(langFromLocale('ja')).toBe('ja')
    expect(langFromLocale('zh_CN')).toBe('zh')
    expect(langFromLocale('fr-CA')).toBe('fr')
    expect(langFromLocale('de-DE')).toBe('en')
  })
})

describe('versiones', () => {
  it('compara versiones numéricamente', async () => {
    const { isNewer } = await import('../../src/shared/version')
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('v0.3.0', '0.2.0')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.2.0-beta', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
  })
})
