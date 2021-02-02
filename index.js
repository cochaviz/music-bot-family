var myArgs = process.argv.slice(2);

const Discord = require('discord.js');
const {
    prefix,
    youtubeApiKey
} = require('./config.json');
const token = myArgs[1];
const ytdl = require('ytdl-core');
const { YTSearcher } = require('ytsearcher');
const { PassThrough } = require('stream');

const searcher = new YTSearcher(youtubeApiKey);
const opts = {
    maxResults: 1,
};

const client = new Discord.Client();

const queue = new Map();


client.once('ready', () => {
    console.log('Ready!');
});

client.once('reconnecting', () => {
    console.log('Reconnecting!');
});

client.once('disconnect', () => {
    console.log('Disconnect!');
});


client.on('message', function (message) {
    // Return if the command has not been sent in the proper channel, or a bot is the author
    if (message.author.bot || message.channel.name != 'hal-9000') return;
    // Return if the client is already in a voice channel and that voice channel is not the voice channel of the sender or the client isn't mentioned in the message
    if (message.guild.voice != null && message.member.voice.channel != message.guild.voice.channel && !findInMap(message.mentions.users, client.user.id)) return;
    if (!message.content.startsWith(prefix)) return;

    const serverQueue = queue.get(message.guild.id);

    if (message.content.startsWith(`${prefix}play`)) {
        enqueue(message, serverQueue);
        return;
    } else if (message.content.startsWith(`${prefix}skip`)) {
        skip(message, serverQueue);
        return;
    } else if (message.content.startsWith(`${prefix}stop`)) {
        stop(message, serverQueue);
        return;
    } else if (message.content.startsWith(`${prefix}join`)) {
        join(message, serverQueue);
        return;
    } else if (message.content.startsWith(`${prefix}pause`)) {
        pause(message, serverQueue);
        return;
    } else if (message.content.startsWith(`${prefix}resume`)) {
        resume(message, serverQueue);
        return;
    } else {
        message.channel.send("You need to enter a valid command!");
    }
});

async function enqueue(message, serverQueue) {
    const args = message.content.split(" ");
    var song = null;

    if (args[1] == null) {
        return message.channel.send("Please enter the name of the song, or a YouTube link!");
    }
    if (validURL(args[1])) {
        const songInfo = await ytdl.getInfo(args[1]);

        if (!songInfo) {
            return message.channel.send("Sorry, I can't seem to find this song...");
        }
        song = {
            title: songInfo.videoDetails.title,
            url: songInfo.videoDetails.video_url,
        }
    } else {
        var query = message.content.substr(message.content.indexOf(" ") + 1);
        if (message.mentions != null) {
            query = query.substring(0, query.lastIndexOf(" "));
        }
        const result = await searcher.search(query, opts);

        if (!result.first) {
            return message.channel.send("Sorry, I can't seem to find this song...");
        }
        song = {
            title: result.first.title,
            url: result.first.url
        };
    }
    serverQueue = await join(message, serverQueue);
    if (!serverQueue) return;

    serverQueue.songs.push(song);
    console.log(serverQueue.songs);

    if (!serverQueue.playing) {
        serverQueue.playing = true;
        play(message.guild, serverQueue.songs[0]);
    } else {
        message.channel.send(`${song.title} has been added to the queue!`);
    }
    return;
}


function play(guild, song) {
    const serverQueue = queue.get(guild.id);

    if (!song || !serverQueue.playing) {
        serverQueue.voiceChannel.leave();
        queue.delete(guild.id);
        return;
    }

    const dispatcher = serverQueue.connection
        .play(ytdl(song.url))
        .on("finish", () => {
            serverQueue.songs.shift();
            play(guild, serverQueue.songs[0]);
        })
        .on("error", error => console.error(error));
    dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
    serverQueue.textChannel.send(`Start playing: **${song.title}**`);
}

function skip(message, serverQueue) {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );
    if (!serverQueue)
        return message.channel.send("There is no song that I could skip!");
    serverQueue.connection.dispatcher.end();
}

function stop(message, serverQueue) {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );

    if (!serverQueue)
        return message.channel.send("There is no song that I could stop!");

    serverQueue.songs = [];
    serverQueue.connection.dispatcher.end();
}

function pause(message, serverQueue) {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );

    if (!serverQueue || serverQueue.songs === [])
        return message.channel.send("There is no song that I could stop!");

    serverQueue.playing = false;
    serverQueue.connection.dispatcher.pause();
}

function resume(message, serverQueue) {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );

    if (!serverQueue || serverQueue.songs === [])
        return message.channel.send("There is no song that I could stop!");

    serverQueue.playing = true;
    serverQueue.connection.dispatcher.resume();
}

async function join(message, serverQueue) {
    const voiceChannel = getVoiceChannel(message);

    if (!voiceChannel) return null;
    if (serverQueue != null && serverQueue.voiceChannel === message.member.voice.channel) return serverQueue;

    // Creating the contract for our queue
    const queueContract = {
        textChannel: message.channel,
        voiceChannel: voiceChannel,
        connection: null,
        songs: [],
        volume: 5,
        playing: false,
    };
    // Setting the queue using our contract
    queue.set(message.guild.id, queueContract);

    try {
        // Here we try to join the voicechat and save our connection into our object.
        var connection = await voiceChannel.join();
        queueContract.connection = connection;
    } catch (err) {
        // Printing the error message if the bot fails to join the voicechat
        console.log(err);
        queue.delete(message.guild.id);
        message.channel.send(err);
        return null;
    }
    return queueContract;
}

function getVoiceChannel(message) {
    const voiceChannel = message.member.voice.channel;

    if (!voiceChannel)
        return message.channel.send(
            "You need to be in a voice channel to play music!"
        );
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
        return message.channel.send(
            "I need the permissions to join and speak in your voice channel!"
        );
    }
    return voiceChannel;
}

function validURL(str) {
    var pattern = new RegExp('^(https?:\\/\\/)?' + // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
    return !!pattern.test(str);
}

function findInMap(map, val) {
    for (let [k, v] of map) {
        if (v.id === val) {
            return true;
        }
    }
    return false;
}

client.login(token);