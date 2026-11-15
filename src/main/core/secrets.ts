import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Cifrado del sistema (Keychain, DPAPI, libsecret). En Electron es `safeStorage`; en pruebas, uno falso. */
export interface SecretCrypto {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/**
 * Guarda claves de API. Solo se escriben a disco si el sistema puede cifrarlas; si no, viven en
 * memoria mientras OUIJA esté abierto. Las claves nunca se guardan en `settings.json` ni se registran.
 */
export class SecretStore {
  private readonly memory = new Map<string, string>()

  constructor(
    private readonly file: string,
    private readonly crypto: SecretCrypto
  ) {}

  /** ¿Se guardan cifradas en disco? */
  get secure(): boolean {
    return this.crypto.available()
  }

  async load(): Promise<void> {
    if (!this.secure) return
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, string>
      for (const [id, b64] of Object.entries(raw)) {
        try {
          this.memory.set(id, this.crypto.decrypt(Buffer.from(b64, 'base64')))
        } catch {
          // Una entrada ilegible (por ejemplo, otro usuario del sistema) se ignora.
        }
      }
    } catch {
      // no existe todavía
    }
  }

  get(id: string): string | undefined {
    return this.memory.get(id)
  }

  has(id: string): boolean {
    return this.memory.has(id)
  }

  ids(): string[] {
    return [...this.memory.keys()]
  }

  async set(id: string, value: string): Promise<void> {
    this.memory.set(id, value)
    await this.persist()
  }

  async delete(id: string): Promise<void> {
    this.memory.delete(id)
    await this.persist()
  }

  private async persist(): Promise<void> {
    if (!this.secure) return
    const out: Record<string, string> = {}
    for (const [id, value] of this.memory) out[id] = this.crypto.encrypt(value).toString('base64')
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(out), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, this.file)
  }
}
