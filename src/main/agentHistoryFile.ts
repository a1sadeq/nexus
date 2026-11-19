import { randomUUID, createHash } from 'node:crypto'
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  lstatSync,
  readdirSync,
  realpathSync
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { HistoryStore } from './agentHistory'

/**
 * Plaintext local history adapter for a caller-owned, dedicated app directory.
 * NOT a sandbox or defense against a hostile same-user process replacing the
 * directory. Only a single live writer is allowed per project; stale locks
 * require manual recovery. No rotating backups are intentionally created.
 * O_NOFOLLOW and rename semantics must be verified on each target platform.
 */
export class AgentHistoryFile implements HistoryStore {
  private readonly file: string
  private readonly lock: string
  private readonly tempPrefix: string
  private closed = false

  constructor(directory: string, projectId: string) {
    if (
      typeof directory !== 'string' ||
      !isAbsolute(directory) ||
      typeof projectId !== 'string' ||
      !projectId.trim() ||
      projectId.length > 1024 ||
      typeof constants.O_NOFOLLOW !== 'number' ||
      constants.O_NOFOLLOW === 0
    )
      throw new Error('Invalid history storage configuration')
    const dir = resolve(directory)
    try {
      if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== dir)
        throw new Error('untrusted path')
    } catch {
      throw new Error('History directory unavailable')
    }
    const key = createHash('sha256').update(projectId, 'utf8').digest('hex')
    this.file = join(dir, `${key}.json`)
    this.lock = join(dir, `${key}.lock`)
    this.tempPrefix = `${key}.tmp-`
    let lockFd: number
    try {
      lockFd = openSync(
        this.lock,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      )
    } catch {
      throw new Error('History storage locked or unavailable')
    }
    closeSync(lockFd)
    try {
      // Dedicated directory only: remove orphan temp files from this project.
      // Never follow symlinks or remove hardlinked files.
      const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      for (const name of readdirSync(dir)) {
        if (
          !name.startsWith(this.tempPrefix) ||
          !pattern.test(name.slice(this.tempPrefix.length)) ||
          name.length !== this.tempPrefix.length + 36
        )
          continue
        const path = join(dir, name),
          stat = lstatSync(path)
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('unsafe temporary file')
        unlinkSync(path)
      }
    } catch {
      try {
        unlinkSync(this.lock)
      } catch {
        /* cleanup is best effort */
      }
      throw new Error('History temporary cleanup failed')
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('History storage closed')
  }

  read(): unknown | null {
    this.assertOpen()
    let fd: number
    try {
      fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('History read failed')
    }
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024)
        throw new Error('invalid file')
      const buffer = Buffer.alloc(8 * 1024 * 1024 + 1)
      let length = 0
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, null)
        if (count === 0) break
        length += count
      }
      if (length > 8 * 1024 * 1024) throw new Error('invalid file')
      const bytes = buffer.subarray(0, length)
      // Fatal decoding avoids accepting altered/corrupt UTF-8 as valid data.
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    } catch {
      throw new Error('History read failed')
    } finally {
      closeSync(fd)
    }
  }

  private assertSafeTarget(): void {
    try {
      const stat = lstatSync(this.file)
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('unsafe target')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error('History target unavailable')
    }
  }

  write(snapshot: unknown): void {
    this.assertOpen()
    const payload = JSON.stringify(snapshot)
    if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > 8 * 1024 * 1024)
      throw new Error('History capacity reached')
    this.assertSafeTarget()
    const temp = `${this.file.slice(0, -5)}.tmp-${randomUUID()}`
    let fd: number | undefined
    let created = false
    try {
      fd = openSync(
        temp,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      )
      created = true
      writeFileSync(fd, payload, 'utf8')
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      this.assertSafeTarget()
      renameSync(temp, this.file)
      created = false
    } catch {
      throw new Error('History write failed')
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          /* cleanup is best effort */
        }
      }
      if (created) {
        try {
          unlinkSync(temp)
        } catch {
          /* startup cleanup will retry */
        }
      }
    }
  }

  close(): void {
    if (this.closed) return
    // If unlink fails, remain closed and report it; stale lock needs recovery.
    this.closed = true
    try {
      unlinkSync(this.lock)
    } catch {
      throw new Error('History lock release failed')
    }
  }
}
