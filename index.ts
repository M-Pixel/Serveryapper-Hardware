import * as url from "url"
import * as https from "https"
import Mailgun = require("mailgun-js");
const conkieStats = require("conkie-stats") as IConkie;

const mailgun = new Mailgun({
	apiKey: process.env.MAILGUN_API_KEY,
	domain: process.env.MAILGUN_DOMAIN
});

function sendAlert(subject:string, text:string):void {
	mailgun.messages().send({
		from: process.env.SEND_EMAILS_FROM,
		to: process.env.SEND_EMAILS_TO,
		subject: subject,
		text: text
	}).catch((error:any) => {
		console.error(JSON.stringify(error));
	});
}

class StatTester {
	protected static minMessageInterval = (new Date(0, 0, 0, 0, Number.parseInt(process.env.MIN_MESSAGE_INTERVAL))).valueOf();
}

class NumberStatTester extends StatTester {
	private isWarning = false;
	private isDangering = false;
	private lastMessaged:number;
	
	constructor(
		private name:string,
		private warningLevel:number,
		private dangerLevel:number
	) { super(); }
	
	test(value:number):void {
		if (value >= this.warningLevel) {
			if (value >= this.dangerLevel) {
				if (this.isDangering === false) {
					this.lastMessaged = Date.now();
					this.isDangering = true;
					sendAlert(`☠ ${this.name} is too damn high!`, `${value} >= ${this.dangerLevel}`);
				}
			} else if (this.isDangering === true && Date.now() - this.lastMessaged < StatTester.minMessageInterval) {
				this.lastMessaged = Date.now();
				this.isDangering = false;
				sendAlert(`⚠ ${this.name} is recovering`, `${value} >= ${this.warningLevel}`);
			} else if (this.isWarning === false) {
				this.isWarning = true;
				sendAlert(`⚠ ${this.name} is getting high!`, `${value} >= ${this.warningLevel}`);
			}
		} else if (this.isWarning === true && Date.now() - this.lastMessaged < StatTester.minMessageInterval) {
			this.isDangering = false;
			this.isWarning = false;
			sendAlert(`👍 ${this.name} has recovered`, `${value} < ${this.warningLevel}`);
		}
	}
}

class MatchStatTester<T> extends StatTester {
	private lastMessaged:number;
	private wasBad = false;
	
	constructor(
		private badValue:T,
		private badMessage:string,
		private goodMessage:string
	) {
		super();
	}

	test(test:T):void {
		const now = Date.now();
		if (test === this.badValue) {
			if (this.wasBad === false && now - this.lastMessaged < StatTester.minMessageInterval) {
				this.wasBad = true;
				this.lastMessaged = now;
				sendAlert(this.badMessage, "");
			}
		} else if (this.wasBad === true && now - this.lastMessaged < StatTester.minMessageInterval) {
			this.wasBad = false;
			this.lastMessaged = now;
			sendAlert(this.goodMessage, "");
		}
		
	}
}

class StatTesters<T> {
	private map = new Map<string, NumberStatTester>();

	constructor(
		private warnLevel:number,
		private dangerLevel:number,
		private identifier:(item:T)=>string,
		private parser:(item:T)=>number
	) {

	}

	test(items:T[]):void {
		for (let item of items) {
			const id = this.identifier(item);
			const value = this.parser(item);
			if (value === undefined)
				continue;
			
			let tester = this.map.get(id);
			if (tester === undefined) {
				tester = new NumberStatTester(id, this.warnLevel, this.dangerLevel);
				this.map.set(id, tester);
			}
			tester.test(value);
		}
	}
}

const memoryTester = new NumberStatTester("RAM", Number.parseFloat(process.env.MEMORY_WARN), Number.parseFloat(process.env.MEMORY_DANGER));
const diskTesters = new StatTesters<IDisk>(
	Number.parseFloat(process.env.DISK_WARN),
	Number.parseFloat(process.env.DISK_DANGER),
	disk => disk.filesystem,
	disk => {
		if (disk.filesystem === "none") {
			return undefined;
		} else {
			const used = Number.parseFloat(disk.used);
			return used / (used + Number.parseFloat(disk.free));
		}
	}
);
const powerTester = new MatchStatTester("discharging", "🔌 Began discharging", "🔋 Power restored");
const tempTester = new NumberStatTester("Temperature", Number.parseFloat(process.env.TEMP_WARN), Number.parseFloat(process.env.TEMP_DANGER))

conkieStats
	.setPollFreq(Number.parseFloat(process.env.POLL_FREQ))	
	.register(["temperature", "memory", "disks", "power"])
	.on("error", err => console.error("conkie-stats error:", err))
	.on("update", processStats);


function processStats(stats:IConkieStats) {
	if (stats.disks !== undefined) {
		diskTesters.test(stats.disks);
	}
	if (stats.memory !== undefined) {
		memoryTester.test(stats.memory.used / stats.memory.total);
	}
	if (stats.power !== undefined && stats.power.length !== 0) {
		powerTester.test(stats.power[0].status)
	}
	if (stats.temperature !== undefined) {
		let temp = 0;
		for (let core of stats.temperature.cores) {
			temp += core;
		}
		temp /= stats.temperature.cores.length;
		tempTester.test(temp);
	}
}


type ConkieSubmodules = "cpu"|"dropbox"|"io"|"memory"|"net"|"system"|"temperature"|"topCPU"|"topMemory"|"disks"|"power";

interface ICpuStats {
	/**
	 * Integer representing the CPU usage (0-100)
	 */
	usage:number;
	
	/**
	 * A three part array listing the 1, 5 and 15 minute load readings as floats (0-1)
	 */
	load:[number, number, number];
}

interface IDisk {
	filesystem:string;
	type:string;
	used:string;
	free:string;
	mount:string;
}

interface IIO {
	/**
	 * The system-wide disk read I/O value in Kbs
	 */
	totalRead:number;
	
	/**
	 * The system-wide disk write I/O value in Kbs
	 */
	totalWrite:number;
}

interface IMemory {
	cache:number;
	free:number;
	used:number;
	total:number;
	buffers:number;
}

interface IBattery {
	charge:number;
	chargeFull:number;
	current:number;
	device:string;
	manufacturer:string;
	percent:number;
	model:string;
	status:"charging"|"discharging";
	voltage:number;
	remainingTime:number;
	remainingChargingTime:number;
	watts:number;
}

interface ISystem {
	/**
	 * The system architecture
	 */
	arch:string;
	
	/**
	 * The hostname of the system
	 */
	hostname:string;
	
	/**
	 * The system uptime in seconds
	 */
	uptime:number;
	
	/**
	 * Node compatible short platform name
	 */
	platform:string;
}

interface ITemperature {
	main?:number;
	
	cores:number[];
}

interface IConkieStats {
	cpu?:ICpuStats;
	disks?:IDisk[];
	files?:{[key:string]:(string|number)[]}
	io?:IIO;
	memory?:IMemory;
	power?:IBattery[];
	system?:ISystem;
	temperature?:ITemperature;
}

interface IModule {
	/**
	 * Identifies the module - automatically appended by the parent process
	 */
	name:string;
	
	/**
	 * Registration callback.
	 * If called with no arguments or with register('*') all non-debugging modules will be loaded - this can cause issues if your setup is missing any of the external dependencies
	 */
	register?(finish:any, parentObject:any):void;
	
	/**
	 * De-registration callback
	 */
	unregister?(finish:any, parentObject:any):void;

	/**
	 * Polling callback - will be invoked by default every 1000ms and can return data as the callback payload. Any payload will automatically be run via update(data)
	 */
	poll?(finish:any, parentObject:any):void;
	
	/**
	 * Object containing the module's settings
	 */
	settings:any;
}

interface INetSettings {
	/**
	 * Use bwm-ng to gather bandwidth stats. If the binary cannot be found when the module is registered this is automatically disabled.
	 * Default is true
	 */
	bwmNg?:boolean;
	
	/**
	 * Remove all network devices that dont have any download or upload - not recommended as it tends to remove devices during a quiet period.
	 * Default is false
	 */
	ignoreNoBandwidth?:boolean;

	/**
	 * Remove all network devices that currently have no IP address.
	 * Default is false
	 */
	ignoreNoIp?:boolean;

	/**
	 * Ignore all devices by device name (e.g. lo to ignore loopback adapater on Linux)
	 * Default is []
	 */
	ignoreDevice?:string[];
}

interface ISettings {
	files?:{[key:string]:string};
	net?:INetSettings;
}

interface IConkie {
	/**
	 * Request a module (corresponds to a filename within the modules/ directory).
	 * Some modules require external binaries and will raise errors if this is not satisfied.
	 * Arguments can be passed as strings or an array of strings.
	 */
	register(submodules:ConkieSubmodules[]):IConkie;
	
	/**
	 * Set the polling frequency for modules that poll (in milliseconds)
	 */
	setPollFreq(timeout:number):IConkie;

	/**
	 * Set the Conkie-Stats settings object
	 */
	settings(settingsObject:ISettings):IConkie;
	
	/**
	 * Merge the main system payload with the provided data.
	 * This is a standard object merge however arrays are taken as mutable objects (i.e. a new array value completely overrides the previous one).
	 */
	update(data:IConkieStats):IConkie;

	/**
	 * Force a poll of all modules. This is really only intended as an internal function.
	 */
	poll():IConkie;

	
	/**
	 * General error handling event
	 */
	on(eventType:"error", callback:(err:string)=>void):IConkie;
	
	/**
	 * General debugging mesages.
	 * This is like error but usually a fail-soft situation (e.g. module can't provide certain information because of a missing binary - it can still do its job but it should complain to someone)
	 */
	on(eventType:"debug", callback:(msg:string)=>void):IConkie;
	
	/**
	 * Event emitted when all module polls have completed
	 */
	on(eventType:"update", callback:(stats:IConkieStats)=>void):IConkie;

	/**
	 * A module has been registered
	 */
	on(eventType:"moduleRegister", callback:(moduleObject:IModule)=>void):IConkie;
	
	/**
	 * Event emitted on each modules update events. Data is unlikely to be complete at this point until update.
	 */
	on(eventType:"updatePartial", callback:(stats:IConkieStats)=>void):IConkie;	
}
