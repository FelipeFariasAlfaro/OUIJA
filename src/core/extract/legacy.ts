import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { ExtractError } from './types'

const execFileAsync = promisify(execFile)

const CONVERT_TIMEOUT_MS = 120_000

let sofficeCache: Promise<string | null> | undefined

function candidates(): string[] {
  const list = ['soffice', 'libreoffice']
  for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]) {
    if (base) list.push(join(base, 'LibreOffice', 'program', 'soffice.exe'))
  }
  return list
}

/** Busca LibreOffice en el PATH y en las rutas habituales de Windows. */
export function findSoffice(): Promise<string | null> {
  sofficeCache ??= (async () => {
    for (const bin of candidates()) {
      try {
        if (bin.includes('/') || bin.includes('\\')) await access(bin)
        await execFileAsync(bin, ['--version'], { timeout: 30_000 })
        return bin
      } catch {
        // siguiente candidato
      }
    }
    return null
  })()
  return sofficeCache
}

// LibreOffice no admite dos conversiones a la vez con el mismo perfil.
let queue: Promise<unknown> = Promise.resolve()
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

/**
 * Convierte un documento antiguo a texto con LibreOffice headless. Trabaja sobre una copia en un
 * directorio temporal: el original nunca se toca.
 */
export function convertLegacy(ext: string, data: Buffer, target: 'txt' | 'csv' = 'txt'): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'
  return serialize(async () => {
    const bin = await findSoffice()
    if (!bin) throw new ExtractError('LibreOffice no está instalado')

    const dir = await mkdtemp(join(tmpdir(), 'medium-lo-'))
    try {
      const input = join(dir, `in.${safeExt}`)
      await writeFile(input, data)
      const profile = pathToFileURL(join(tmpdir(), 'medium-lo-profile')).href
      await execFileAsync(
        bin,
        [
          '--headless',
          '--norestore',
          '--nolockcheck',
          `-env:UserInstallation=${profile}`,
          '--convert-to',
          target === 'csv' ? 'csv:Text - txt - csv (StarCalc):44,34,76,1' : 'txt:Text (encoded):UTF8',
          '--outdir',
          dir,
          input
        ],
        { timeout: CONVERT_TIMEOUT_MS }
      )
      return await readFile(join(dir, `in.${target}`), 'utf8')
    } catch (error) {
      if (error instanceof ExtractError) throw error
      throw new ExtractError(`LibreOffice no pudo convertir el archivo: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

/**
 * Convierte un documento o planilla antigua a un formato de hoy (DOCX o XLSX) con LibreOffice,
 * conservando el formato. Trabaja sobre una copia temporal; el original nunca se toca.
 */
export function convertLegacyToModern(ext: string, data: Buffer, target: 'docx' | 'xlsx'): Promise<Buffer> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'
  return serialize(async () => {
    const bin = await findSoffice()
    if (!bin) throw new ExtractError('LibreOffice no está instalado')
    const dir = await mkdtemp(join(tmpdir(), 'medium-lo-'))
    try {
      const input = join(dir, `in.${safeExt}`)
      await writeFile(input, data)
      const profile = pathToFileURL(join(tmpdir(), 'medium-lo-profile')).href
      await execFileAsync(bin, ['--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=${profile}`, '--convert-to', target, '--outdir', dir, input], {
        timeout: CONVERT_TIMEOUT_MS
      })
      return await readFile(join(dir, `in.${target}`))
    } catch (error) {
      if (error instanceof ExtractError) throw error
      throw new ExtractError(`LibreOffice no pudo convertir el archivo: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
