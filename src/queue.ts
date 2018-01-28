import {EventEmitter} from 'events'

export class Queue<T> extends EventEmitter {

    public readonly items: T[] = []

    private inFlight = 0

    constructor(
        public readonly concurrency: number,
        public readonly worker: (item: T) => Promise<void>
    ) {
        super()
    }

    public push(item: T) {
        this.items.push(item)
        if (this.inFlight < this.concurrency) {
            this.next()
        }
    }

    private next() {
        const item = this.items.shift()
        if (!item) {
            return
        }
        this.inFlight++
        const done = () => {
            this.inFlight--
            this.next()
        }
        this.worker(item).then(done).catch((error) => {
            this.emit('error', error)
            done()
        })
    }

}
