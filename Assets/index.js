const util = {
	waitForElementById: async function(id, timeout = 0) {
		return new Promise(function(resolve, reject) {
			// Check if the element already exists
			let element = document.getElementById(id)

			if (element) {
				resolve(element)
				return
			}
	
			// Create a MutationObserver to watch for DOM changes
			const observer = new MutationObserver(() => {
				element = document.getElementById(id)

				if (element) {
					observer.disconnect() // Stop observing once found
					resolve(element) // Resolve the promise
				}
			})
	
			// Start observing the DOM for changes
			observer.observe(document.getRootNode(), {
				childList: true,
				subtree: true
			})
	
			// Optional timeout handling
			if (timeout > 0) {
				setTimeout(
					function() {
						observer.disconnect();
						reject(new Error(`Element with ID "${id}" not found within ${timeout}ms`))
					},

					timeout
				)
			}
		})
	}
}

async function main() {

	const CONFIG = Object.freeze({

		// DOM References
		HTMLElements: Object.freeze({
			DEBUG_SCREEN: util.waitForElementById("DebugScreen"),
			TERMINAL_CONTAINER: util.waitForElementById("Terminal"),
		}),

		// Underlying emulator
		X86Emulator: Object.freeze({
			WASM_PATH: "Assets/v86/v86.wasm",
	
			MEMORY_SIZE: 512 * 1024 * 1024, // ? MB
			VGA_MEMORY_SIZE: 100 * 1024 * 1024, // ? MB
	
			BIOS_IMAGE_PATH: "Assets/BinaryImages/seabios.bin",
			VGA_BIOS_IMAGE_PATH: "Assets/BinaryImages/vgabios.bin",
	
			OS_IMAGE_PATH: "Assets/BinaryImages/os.iso",
		}),
	
		// Provisioning script
		ProvisioningScript: (fetch("Assets/ShellScripts/InitialProvisioning.sh")
			.then(function(response) {
				if (response.ok) {
					return response.text()
				}

				return ""
			})
			.catch(function(error) {
				console.error("Failed to fetch provisioning script", error);
			})
		),
	})
	
	let frontendTerminal
	let virtualMachine
	
	let booted = false
	
	// Login as root
	const username = "root"
	
	// Start a shell on /dev/console for debugging,
	// set the TERM variable to a colored terminal,
	// fix enter key on some applications
	// and resize commands and execute the welcome script
	// const welcomecmd = 'screen -d -m sh -c "sh </dev/console >/dev/console 2>&1;read";TERM="xterm-256color";stty sane;/etc/init.d/S99welcome';
	const welcomecmd = 'screen -d -m sh -c "sh </dev/console >/dev/console 2>&1;read";TERM="xterm-256color";stty sane;'///etc/init.d/S99welcome';
	
	window.addEventListener("load", async function() {

		// Debug mode logic
		let getDebugMode
		var setDebugMode
		{
			let debugMode = false

			getDebugMode = function() {
				return debugMode
			}

			setDebugMode = function(value) {
				if (typeof value !== "boolean") {
					console.error("Invalid value for debug mode. Expected a boolean.");
					return;
				}

				debugMode = value

				updateUIDebugMode()
			}

			// Updates UI to reflect debug mode
			async function updateUIDebugMode() {
				if (getDebugMode()) {
					(await CONFIG.HTMLElements.DEBUG_SCREEN).classList.add("visible")
				} else {
					(await CONFIG.HTMLElements.DEBUG_SCREEN).classList.remove("visible")
				}
			}

			// Expose debug getter and setter functions to the global scope
			window.NON_CANON_INTERNAL_getDebugMode = getDebugMode
			window.NON_CANON_INTERNAL_setDebugMode = setDebugMode
		}

		// Enable debug mode if the URL contains a hash
		if (window.location.hash == "#debug") {
			setDebugMode(true)
		}
	
		// Initialize the v86 emulator
		virtualMachine = new V86Starter({
			wasm_path: CONFIG.X86Emulator.WASM_PATH,
	
			memory_size: CONFIG.X86Emulator.MEMORY_SIZE,
			vga_memory_size: CONFIG.X86Emulator.VGA_MEMORY_SIZE,
	
			screen_container: await CONFIG.HTMLElements.DEBUG_SCREEN,
	
			bios: {url: CONFIG.X86Emulator.BIOS_IMAGE_PATH},
	
			vga_bios: {url: CONFIG.X86Emulator.VGA_BIOS_IMAGE_PATH},
	
			cdrom: {url: CONFIG.X86Emulator.OS_IMAGE_PATH},
	
			autostart: true,
		})
	
		// Initialize xterm.js and xterm-addon-fit
		frontendTerminal = new Terminal({rendererType: 'dom',})

		let terminalFitter = new FitAddon.FitAddon()
		frontendTerminal.loadAddon(terminalFitter)

		frontendTerminal.open(await CONFIG.HTMLElements.TERMINAL_CONTAINER)
		
		terminalFitter.fit();
	
		// Write a "Booting WebTerm ..." message
		frontendTerminal.write('\x1b[1;34mDownloading\x1b[0m OS images ...\r\n')
	
		// Forward keystrokes from xterm to v86
		frontendTerminal.onKey(key => onConsoleInput(key))

		// Forward output from v86 to xterm and other functions 
		virtualMachine.add_listener("serial0-output-char", function(char) {
			// Only write to the xterm if the system is fully booted
			if(booted) {
				frontendTerminal.write(char)
			}

			// If the char is the shell prompt after the login message start
			// Run the welcome script and set booted to true
			if(char == "#" && previous_line.includes("buildroot login: "+username)) {
				virtualMachine.serial0_send(welcomecmd+"\n")

				resize()

				booted = true
			}
		})
		
		virtualMachine.add_listener("serial0-output-line", (line) => onConsoleLine(line))
	
		// Wait for the emulator to get ready
		virtualMachine.add_listener("emulator-ready", () => {
			frontendTerminal.write('Booting \x1B[1;3;31mWebTerm\x1B[0m ...\r\n')
			debug("KIAN emulator-ready")
		})
	})
	
	var debugCount = 0
	var debugWord = "+++debug+++"
	function onConsoleInput(key) {
		// Paste (Strg+Alt+V)
		if((key.domEvent.key == "v") && key.domEvent.altKey && key.domEvent.ctrlKey) {
			debug("paste")
			navigator.clipboard.readText().then((text) => {
				virtualMachine.serial0_send(text)
			})
			return
		}
	
		// Copy (Strg+Alt+C)
		if((key.domEvent.key == "c") && key.domEvent.altKey && key.domEvent.ctrlKey) {
			debug("copy")
			document.execCommand("copy")
			return
		}
	
		// Send keys from xterm to v86
		virtualMachine.serial0_send(key.key)
	
		// Listen for the debug key combination
		if(key.key == debugWord[debugCount]) {
			debugCount++
		} else {
			debugCount = 0
		}
		if(debugCount == debugWord.length) {
			document.getElementById("screen").classList.toggle("visible");
		}
		debug("debugcnt "+debugCount)
	}
	
	var previous_line = ""
	function onConsoleLine(line) {
		// Enter username on the login prompt
		if (line.startsWith("Welcome to WebTerm")) {
			virtualMachine.serial0_send(username+"\n")
		}
		// Save the line
		previous_line = line
	}
	
	// Resize the terminal
	window.addEventListener("resize", () => {
		resize()
	})
	
	function resize() {
		// Resize the terminal
		termfit.fit()
	
		// Send tty resize over /dev/console so that the user can't see it
		virtualMachine.keyboard_send_text(`stty cols ${frontendTerminal.cols} rows ${frontendTerminal.rows} -F /dev/ttyS0\n`)
	}
	
	function debug(text) {
		console.debug("DEBUG: "+text)
	}
}

main()
