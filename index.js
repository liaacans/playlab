require('./settings');
const fs = require('fs');
const pino = require('pino');
const path = require('path');
const chalk = require('chalk');
const FileType = require('file-type')
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const PhoneNumber = require('awesome-phonenumber')
const { exec, spawn, execSync } = require('child_process');
const { default: makeWASocket,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState,
	DisconnectReason,
	fetchLatestBaileysVersion,
	generateForwardMessageContent,
	prepareWAMessageMedia,
	generateWAMessageFromContent,
	generateMessageID,
	downloadContentFromMessage,
	makeInMemoryStore,
	getContentType,
	jidDecode,
    MessageRetryMap,
	getAggregateVotesInPollMessage,
	proto,
	delay } = require('@whiskeysockets/baileys');

const usePairingCode = true
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

global.api = (name, path = '/', query = {}, apikeyqueryname) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikeyqueryname ? '?' + decodeURIComponent(new URLSearchParams(Object.entries({ ...query, ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {}) }))) : '')

const DataBase = require('./src/database');
const database = new DataBase(global.tempatDB);
const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });


(async () => {
	const loadData = await database.read()
	if (loadData && Object.keys(loadData).length === 0) {
		global.db = {
			set: {},
			users: {},
			game: {},
			groups: {},
			database: {},
			...(loadData || {}),
		}
		await database.write(global.db)
	} else {
		global.db = loadData
	}
	
	setInterval(async () => {
		if (global.db) await database.write(global.db)
	}, 30000)
})();

const { GroupUpdate, GroupParticipantsUpdate, MessagesUpsert, Solving } = require('./src/message');
const { isUrl, generateMessageTag, getBuffer, getSizeMedia, fetchJson, sleep } = require('./lib/function');

/*
	* Create By Naze
	* Follow https://github.com/nazedev
	* Whatsapp : https://whatsapp.com/channel/0029VaWOkNm7DAWtkvkJBK43
*/

async function startNazeBot() {
	const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })
	const resolveMsgBuffer = new NodeCache()
	const { state, saveCreds } = await useMultiFileAuthState('nazedev');
	const { version, isLatest } = await fetchLatestBaileysVersion();
	const level = pino({ level: 'silent' })
	
	const getMessage = async (key) => {
		if (store) {
			const msg = await store.loadMessage(key.remoteJid, key.id);
			return msg?.message || ''
		}
		return {
			conversation: 'Halo Saya Naze Bot'
		}
	}
	
	const naze = makeWASocket({
version: (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version,
browser: ['Ubuntu', 'Safari', '18.1'],
keepAliveIntervalMs: 50000,
printQRInTerminal: !usePairingCode,
logger: pino({ level: "silent" }),
auth: state,
generateHighQualityLinkPreview: true,
resolveMsgBuffer,
});
if(usePairingCode && !naze.authState.creds.registered) {
     let phoneNumber = await question(``)
     console.log("Send Number : ")
		phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
		const code = await naze.requestPairingCode(phoneNumber.trim())
		console.log(`Pairing Code :`, code)
    }

	store.bind(naze.ev)
	
	
	naze.ev.on('creds.update', saveCreds)
	
	naze.ev.on('connection.update', (update) => {
const {connection,lastDisconnect} = update
if (connection === 'close') {lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut ? startNazeBot() : ''}
else if(connection === 'open') { 
try {
} catch {}
console.log('Tersambung Kembali')
}
console.log(update)})
naze.ev.on('creds.update', saveCreds)
	
	naze.ev.on('contacts.update', (update) => {
		for (let contact of update) {
			let id = naze.decodeJid(contact.id)
			if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
		}
	});
	
	naze.ev.on('call', async (call) => {
			for (let id of call) {
				if (id.status === 'offer') {
					let msg = await naze.sendMessage(id.from, { text: `Saat Ini, Kami Tidak Dapat Menerima Panggilan ${id.isVideo ? 'Video' : 'Suara'}.\nJika @${id.from.split('@')[0]} Memerlukan Bantuan, Silakan Hubungi Owner :)`, mentions: [id.from]});
					await naze.sendContact(id.from, global.owner, msg);
					await naze.rejectCall(id.id, id.from)
				}
			}
	});
	
	naze.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        }
        else return jid
    }
    
    naze.getFile = async (PATH, save) => {
let res
let data = Buffer.isBuffer(PATH) ? PATH : /^data:.*?\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split`,`[1], 'base64') : /^https?:\/\//.test(PATH) ? await (res = await getBuffer(PATH)) : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(PATH)) : typeof PATH === 'string' ? PATH : Buffer.alloc(0)
//if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer')
let type = await FileType.fromBuffer(data) || {
mime: 'application/octet-stream',
ext: '.bin'
}
filename = path.join(__filename, '../' + new Date * 1 + '.' + type.ext)
if (data && save) fs.promises.writeFile(filename, data)
return {
res,
filename,
size: await getSizeMedia(data),
...type,
data
}}
naze.downloadMediaMessage = async (message) => {
let mime = (message.msg || message).mimetype || ''
let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
const stream = await downloadContentFromMessage(message, messageType)
let buffer = Buffer.from([])
for await(const chunk of stream) {
buffer = Buffer.concat([buffer, chunk])}
return buffer} 
naze.sendFromOwner = (jid, text, quoted = '', options) => naze.sendMessage(jid, { text: text, ...options }, { quoted })
naze.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
let buffer
if (options && (options.packname || options.author)) {
buffer = await writeExifImg(buff, options)
} else {
buffer = await imageToWebp(buff)}
await naze.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
return buffer}
naze.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
let buffer
if (options && (options.packname || options.author)) {
buffer = await writeExifVid(buff, options)
} else {
buffer = await videoToWebp(buff)}
await naze.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
return buffer}
naze.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
let quoted = message.msg ? message.msg : message
let mime = (message.msg || message).mimetype || ''
let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
const stream = await downloadContentFromMessage(quoted, messageType)
let buffer = Buffer.from([])
for await(const chunk of stream) {
buffer = Buffer.concat([buffer, chunk])}
let type = await FileType.fromBuffer(buffer)
trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
// save to file
await fs.writeFileSync(trueFileName, buffer)
return trueFileName}

	
	naze.ev.on('messages.upsert', async (message) => {
		await MessagesUpsert(naze, message, store, groupCache);
	});
	
	naze.ev.on('groups.update', async (update) => {
		await GroupUpdate(naze, update, store, groupCache);
	});
	
	naze.ev.on('group-participants.update', async (update) => {
		await GroupParticipantsUpdate(naze, update, store, groupCache);
	});

	return naze
}

startNazeBot()

let file = require.resolve(__filename)
fs.watchFile(file, () => {
	fs.unwatchFile(file)
	console.log(chalk.redBright(`Update ${__filename}`))
	delete require.cache[file]
	require(file)
});
