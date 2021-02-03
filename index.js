require('dotenv').config()

const youtubeApiKey = process.env.YOUTUBE
const Discord = require('discord.js');
const ytdl = require('ytdl-core');
const { YTSearcher } = require('ytsearcher');
const { PassThrough } = require('stream');

const { prefix } = require('./config.json');
const { Http2ServerRequest } = require('http2');
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


client.on('message', (message) => {
    var hasMention = message.mentions.users.size > 0;
    var isMentioned = hasMention && findInMap(message.mentions.users, client.user.id);
    var notInSameChannel = message.guild.voice != null && message.member.voice.channel != message.guild.voice.channel;

    // Don't listen to the message if it's not a command
    if (!message.content.startsWith(prefix)) return;
    // Return if the command has not been sent in the proper channel, or a bot is the author
    if (message.author.bot || message.channel.name != 'hal-9000') return;
    // Return if the message has a mention, but we're not mentioned
    if (hasMention && !isMentioned) return;
    // Join the channel if the bot is mentioned and they're not in the same channel
    if (notInSameChannel && !hasMention && !isMentioned) return;

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
    } else if (message.content.startsWith(`${prefix}list`)) {
        list(message, serverQueue);
        return;
    } else if (message.content.startsWith(`${prefix}leave`)) {
        leave(message);
        return;
    } else if (message.content.startsWith(`${prefix}help`)) {
        help(message);
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
    } else if (validURL(args[1])) {
        const songInfo = await ytdl.getInfo(args[1]).catch((e) => {
            console.log("There seems to be something wrong with the current link", e);
            return null
        });
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
        const result = await searcher.search(query, opts).catch((e) => {
            console.log("An error occured while trying to search using the youtube API", e);
            return null;
        });
        if (!result || !result.first) {
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
        serverQueue.currentlyPlaying = serverQueue.songs[0];
        play(message.guild, serverQueue.currentlyPlaying);
    } else {
        message.channel.send(`${song.title} has been added to the queue!`);
    }
    return;
}


function play(guild, song) {
    const serverQueue = queue.get(guild.id);

    if (!song) {
        serverQueue.voiceChannel.leave();
        queue.delete(guild.id);
        return serverQueue.textChannel.send("There are no more songs in the queue! Bye!");
    }

    const dispatcher = serverQueue.connection
        .play(ytdl(song.url))
        .on("finish", () => {
            serverQueue.songs.shift();
            serverQueue.currentlyPlaying = serverQueue.songs[0];
            play(guild, serverQueue.currentlyPlaying);
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

    if (!serverQueue || !serverQueue.playing)
        return message.channel.send("There is no song that I could stop!");

    try {
        serverQueue.connection.dispatcher.end();
    } catch (e) {
        return message.channel.send("Something went wrong while trying to stop playing, ask an admin!");
    } finally {
        leave(message);
    }
}

function pause(message, serverQueue) {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );

    if (!serverQueue)
        return message.channel.send("There is no song that I could stop!");

    if (!serverQueue.playing)
        return message.channel.send("There doesn't seem to be a song playing!");

    try {
        serverQueue.playing = false;
        serverQueue.connection.dispatcher.pause();
        return message.channel.send("Paused!");
    } catch (e) {
        return message.channel.send("Something went wrong while trying to resume the music. Try adding songs to the playlist!");
    }
}

function resume(message, serverQueue) {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );

    if (!serverQueue || serverQueue.songs.length == 0)
        return message.channel.send("There is no song that I could start!");

    if (serverQueue.playing)
        return message.channel.send("It seems like there is already a song playing!");

    try {
        serverQueue.playing = true;
        serverQueue.connection.dispatcher.resume();
        return message.channel.send(`Resumed playing **${serverQueue.songs[0].title}**`);
    } catch (e) {
        return message.channel.send("Something went wrong while trying to resume the music. Try adding songs to the playlist!");
    }
}

function list(message, serverQueue) {
    if (!serverQueue || serverQueue.songs.length == 0)
        return message.channel.send("Ohno, we're out of music! Quick! Add something!");

    var list = "";
    list += `> Currently Playing: **${serverQueue.songs[0].title}**\n> \n`;
    if (serverQueue.songs.length > 1) {
        list += "> Queue:\n";
        serverQueue.songs.forEach((song, i) => (i > 0) ? list += `> ${i} : **${song.title}**\n` : null);
    } else {
        list += "**So empty :disappointed:**";
    }
    message.channel.send(list);
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

function leave(message) {
    const voiceChannel = getVoiceChannel(message);
    voiceChannel.leave();
}

function help(message) {
    message.channel.send(
        "```Hey! I'm a music bot with a bunch of features!\n\n" +
        "I'm especially made to work in conjuction with the other bots in this channel\n" +
        "If you want to control a specific bot make sure to end the command with a tag (@bot_name)\n" +
        "If I'm already in your voice channel I'll also respond without a tag!\n" +
        "When you want to play a song, you can either enter a search query, or a youtube link!\n\n" +
        "/join: Join the current active voice channel you're in\n" +
        "/play: Add a song to the queue, and play if it's not already\n" +
        "/stop: Stop and delete the queue\n" +
        "/skip: Skip the current track\n" +
        "/pause: Pause the music\n" +
        "/resume: Resume the music\n" +
        "/leave: Resume the music\n" +
        "/list: Shows a list of the current queue\n" +
        "/help: Show this help\n\n" +
        "Example: /play https://www.youtube.com/watch?v=dQw4w9WgXcQ @music-senpai```"
    );
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

var myArgs = process.argv.slice(2);
var token;

if (myArgs[0] == 'A')
    token = process.env.A;
else if (myArgs[0] == 'B')
    token = process.env.B;
else
    return;

client.login(token);