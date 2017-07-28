import * as fs from "fs"

export enum Priority {
	SILENT = -2,
	QUIET = -1,
	NORMAL = 0,
	HIGH = 1,
	URGENT = 2
}

export function addJob(name: string, job: Function, interval: number, exceptionPriority = 0): void {
	const intervalKey = setInterval(() => {
		try {
			job();
		} catch (error) {
			sendPushover({
				title: `🐞 Exception in job ${name}`,
				message: JSON.stringify(error),
				priority: exceptionPriority
			});
		}
	}, interval);
}

export interface IPushoverMessage {
	message:string;
	title?:string;
	sound?:string;
	device?:string;
	priority?:Priority;
}
declare class IPushover {
	constructor(options:{user:string, token:string, onError?:(error:string)=>void, update_sounds?:boolean});
	send(msg:IPushoverMessage, callback:(err:string, result:string)=>void):void;
}
var Pushover = require("pushover-notifications") as typeof IPushover;
var pushover = new Pushover({user: "uwr3v2974oziv9rh63m955yv24m74j", token: ""});

export function sendPushover(message:IPushoverMessage):void {
	pushover.send(message, (err, result) => {
		fs.appendFile("./log.txt", `Pushover error: ${JSON.stringify(err)}. Message: ${JSON.stringify(message)}`, "utf8");
	});
}
