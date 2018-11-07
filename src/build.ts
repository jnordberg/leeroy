import * as Bunyan from 'bunyan'
import * as config from 'config'
import * as Docker from 'dockerode'
import * as fs from 'fs-extra'
import * as minimatch from 'minimatch'
import * as Git from 'nodegit'
import * as path from 'path'
import * as tar from 'tar-fs'
import {parse as parseUrl} from 'url'

const authconfig = config.get('auth')
const docker = new Docker()

/** Parse a .dockerignore file and return filter function. */
function dockerignore(data: Buffer | string) {
    const patterns = String(data).split('\n')
        .map((line) => line.trim())
        .map((line) => line.endsWith(path.sep) ? line.slice(0, -path.sep.length) : line)
        .filter((line) => line.length > 0 && line !== '.' && line !== '..')
        .map((line) => minimatch.makeRe(line))
        .filter((pattern: any) => pattern !== false)
    return (file: string) => {
        for (const pattern of patterns) {
            if (pattern.test(file)) {
                return true
            }
         }
        return false
     }
}

/** Return a promise that resolves when docker stream finishes. */
async function waitForDocker(stream: any, onProgress: (event) => void) {
    return new Promise<any>((resolve, reject) => {
        const done = (error, result) => {
            if (error) { reject(error) } else { resolve(result) }
        }
        docker.modem.followProgress(stream, done, onProgress)
    })
}

export interface BuildOptions {
    /** Git repository url. */
    repository: string
    /** Git branch that will be checked out. */
    branch: string
    /** Image name, e.g. user/project */
    name: string
    /** Image tag, e.g. latest */
    tag: string
}

export async function build(options: BuildOptions, dir: string, log: Bunyan) {
    await fs.ensureDir(dir)
    let error: Error | undefined
    try {
        await internalBuild(options, dir, log)
    } catch (err) {
        error = err
    }
    await fs.remove(dir)
    if (error) {
        throw error
    }
}

async function internalBuild(options: BuildOptions, workDir: string, logger: Bunyan) {
    logger.debug('cloning %s branch %s', options.repository, options.branch)
    const repo = await Git.Clone.clone(options.repository, workDir, {
        checkoutBranch: options.branch,
        fetchOpts: {
            callbacks: {
                credentials: (url, username) => {
                    if (config.has('ssh')) {
                        const pubkey: string = config.get('ssh.pubkey')
                        const privkey: string = config.get('ssh.privkey')
                        const password: string = config.has('ssh.password') ? config.get('ssh.password') : ''
                        return Git.Cred.sshKeyNew(username, pubkey, privkey, password)
                    } else {
                        return Git.Cred.sshKeyFromAgent(username)
                    }
                }
            }
        }
    })

    let ignore = (file: string) => false
    try {
        const data = await fs.readFile(path.join(workDir, '.dockerignore'))
        const test = dockerignore(data)
        ignore = (file: string) => test(path.relative(workDir, file))
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error
        }
    }

    const t = `${ options.name }:${ options.tag }`
    logger.debug('building tag %s', t)
    const tarStream = tar.pack(workDir, {ignore})
    tarStream.on('error', (error) => {
        logger.warn(error, 'unexpected error when creating tarball')
    })
    const buildStream = await docker.buildImage(tarStream, {t})

    await waitForDocker(buildStream, (event) => {
        let msg = event.stream || ''
        if (msg.endsWith('\n')) {
            msg = msg.slice(0, -1)
        }
        if (msg.length > 0) {
            logger.debug(msg)
        }
    })

    const image = docker.getImage(t)
    logger.debug('pushing %s', t)
    const pushStream = await image.push({authconfig})

    await waitForDocker(pushStream, (event) => {
        if (event.status === 'Pushed') {
            logger.debug('pushed %s', event.id)
        }
    })
}
