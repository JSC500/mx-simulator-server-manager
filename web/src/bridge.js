/*
  mxweb bridge, loaded into every mxserver with --javascript.

  Writes the live state to .mxweb/status.json once a second, keeps the recent chat,
  saves each race's timing to results/<id>.json, and adds the mxwebsay commands the
  web app sends over --xcmd-password. See js/README.TXT in the mxserver download.
*/
(function () {
	var MAX_CHAT = 100;
	var COLORS = { white: "\x1b[37m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m", magenta: "\x1b[35m", red: "\x1b[31m" };
	var RESET = "\x1b[0m";
	var SAY = /^\s*mxwebsay\s+(\w+)\s+(.+)$/;
	var SAY_TO = /^\s*mxwebsayto\s+(\d+)\s+(\w+)\s+(.+)$/;

	var chat = [];
	// Keyed by "slot:uid" so a rider who leaves keeps their result when someone else takes the slot
	var timing = {};
	var raceStart = Date.now();

	function num(name, i) { return mxserver.get_number(name, i || 0); }
	function str(name, i) { return mxserver.get_string(name, i || 0); }

	// An exception in a handler must never take the game server down
	function guard(fn) {
		return function () {
			try {
				return fn.apply(null, arguments);
			} catch (e) {
				mxserver.log("mxweb bridge: " + e + "\n");
				return 0;
			}
		};
	}

	function addChat(who, text, color) {
		chat.push({ t: Date.now(), who: who, text: text, color: color || null });
		if (chat.length > MAX_CHAT)
			chat.shift();
	}

	// Timing positions count gates; the trackinfo's firstlap/normallap say how many make a lap
	function lapsDone(pos) {
		var first = num("first_lap_length"), normal = num("normal_lap_length"), gates = pos + 1;
		if (first <= 0 || normal <= 0 || gates < first)
			return 0;
		return 1 + Math.floor((gates - first) / normal);
	}

	function ranking() {
		var list = [], k;
		for (k in timing)
			list.push(timing[k]);
		list.sort(function (a, b) { return b.pos - a.pos || a.time - b.time; });
		return list;
	}

	function onTiming(slot, pos, time) {
		var info = mxserver.get_slot_info(slot), key = slot + ":" + info.uid, r = timing[key];
		if (!r)
			r = timing[key] = { slot: slot, uid: info.uid, name: info.name, number: info.number, bike: info.bike, pos: -1, time: 0, laps: [] };
		if (pos <= r.pos)
			return;
		r.pos = pos;
		r.time = time;
		while (r.laps.length < lapsDone(pos))
			r.laps.push(time);
	}

	function writeStatus() {
		var order = ranking(), place = {}, players = [], i, info, r;

		for (i = 0; i < order.length; i++)
			place[order[i].slot + ":" + order[i].uid] = i + 1;

		for (i = 0; i < mxserver.max_slots; i++) {
			info = mxserver.get_slot_info(i);
			if (info.status != "Player" && info.status != "Spectator")
				continue;
			r = timing[i + ":" + info.uid];
			players.push({
				slot: i, name: info.name, number: info.number, uid: info.uid, bike: info.bike,
				ping: Math.round(info.ping * 1000), status: info.status, rank: info.rank,
				muted: num("muted", i) != 0, place: place[i + ":" + info.uid] || null, laps: r ? r.laps.length : 0
			});
		}

		mxserver.string_to_file(".mxweb/status.json", JSON.stringify({
			t: Date.now(),
			track: { dir: str("track_dir"), name: str("track_name") },
			raceTime: num("race_time"),
			finishLaps: num("finish_laps"),
			finishTime: num("finish_time"),
			leaderLaps: order.length ? order[0].laps.length : 0,
			players: players,
			chat: chat
		}));
	}

	function saveResults() {
		var order = ranking(), id;
		if (!order.length)
			return;
		id = String(Date.now());
		mxserver.string_to_file("results/" + id + ".json", JSON.stringify({
			id: id,
			start: raceStart,
			end: Date.now(),
			track: { dir: str("track_dir"), name: str("track_name") },
			finishLaps: num("finish_laps"),
			finishTime: num("finish_time"),
			riders: order.map(function (r) {
				return { name: r.name, uid: r.uid, number: r.number, bike: r.bike, laps: r.laps, gates: r.pos + 1 };
			})
		}));
		// Only there when demos are turned on in the settings
		mxserver.system("test -f .mxweb/demo.mxdemo && cp .mxweb/demo.mxdemo results/" + id + ".mxdemo");
	}

	function paint(color, text) {
		return (COLORS[color] || "") + text + RESET;
	}

	var prevTiming = mxserver.timing_handler;
	mxserver.timing_handler = guard(function (slot, pos, time) {
		onTiming(slot, pos, time);
		if (prevTiming)
			prevTiming(slot, pos, time);
	});

	var prevSecond = mxserver.second_handler;
	mxserver.second_handler = guard(function () {
		writeStatus();
		if (prevSecond)
			prevSecond();
	});

	var prevStart = mxserver.start_handler;
	mxserver.start_handler = guard(function () {
		timing = {};
		raceStart = Date.now();
		if (prevStart)
			prevStart();
	});

	var prevFinish = mxserver.finish_handler;
	mxserver.finish_handler = guard(function () {
		saveResults();
		timing = {};
		if (prevFinish)
			prevFinish();
	});

	var prevChat = mxserver.chat_handler;
	mxserver.chat_handler = guard(function (slot, msg) {
		// Another script may filter the message; then it never reached the other players either
		if (prevChat && prevChat(slot, msg))
			return 1;
		addChat(mxserver.get_slot_info(slot).name, msg);
		return 0;
	});

	var prevReady = mxserver.ready_handler;
	mxserver.ready_handler = guard(function (slot) {
		var name = mxserver.get_slot_info(slot).name;
		if (name)
			addChat(null, name + " joined");
		if (prevReady)
			prevReady(slot);
	});

	var prevDisconnect = mxserver.disconnect_handler;
	mxserver.disconnect_handler = guard(function (slot) {
		var name = mxserver.get_slot_info(slot).name;
		if (name)
			addChat(null, name + " left");
		if (prevDisconnect)
			prevDisconnect(slot);
	});

	var prevCommand = mxserver.command_handler;
	mxserver.command_handler = guard(function (slot, line) {
		var m;
		// Only from the web app (external commands have no slot), never from players
		if (slot == mxserver.max_slots) {
			if ((m = line.match(SAY_TO))) {
				mxserver.send(parseInt(m[1], 10), paint(m[2], m[3]));
				addChat("Server to " + mxserver.get_slot_info(parseInt(m[1], 10)).name, m[3], m[2]);
				return 1;
			}
			if ((m = line.match(SAY))) {
				mxserver.broadcast(paint(m[1], m[2]));
				addChat("Server", m[2], m[1]);
				return 1;
			}
		}
		return prevCommand ? prevCommand(slot, line) : 0;
	});
})();
