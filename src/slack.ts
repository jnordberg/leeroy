import * as needle from 'needle'

interface SlackMessage {
    text: string
    channel?: string
}

export class SlackWebhook {

    constructor(private url: string, private channel?: string) {}

    public async send(text: string) {
        const msg: SlackMessage = {text, channel: this.channel}
        return needle('post', this.url, msg, {json: true})
    }

}
