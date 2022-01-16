require('dotenv').config()
const { Client, Intents, MessageEmbed } = require('discord.js')
const fetch = require('node-fetch');
const axios = require("axios");
const cheerio = require("cheerio");
// const fs = require("fs");

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_REACTIONS] })

const RIOT_API = process.env.RIOT_API
const prefix = '!'
const url = "https://u.gg/lol/top-lane-tier-list?rank=overall&region=na1";


const getAbrrevPosition = (position) => {
  if (position === 'BOTTOM'){
    return 'B'
  } else if (position === 'SUPPORT'){
    return 'S'
  } else if (position === 'JUNGLE'){
    return 'J'
  } else if (position === 'MIDDLE'){
    return 'M'
  }
  return 'T';
}
client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`)
  await scrapeData('TOP')
})

client.on("messageCreate", async (msg) => {
  const message = msg.content.toLowerCase();
  if (message.startsWith(prefix + 'live')){
    const name = message.substr(message.indexOf(' ')+1);
    const liveInfo = await getLive(name);
    if(liveInfo.error){
      msg.channel.send(liveInfo.msg)
    }else{
      let blueTeamSummoner = '';
      let redTeamSummoner = '';
      let blueTeamRank = '';
      let redTeamRank = '';
      liveInfo.data.forEach(participant => {
        if (participant.isBlueTeam){
          blueTeamSummoner+=`${participant.summonerName} -- ${participant.championId}\n\n`
          blueTeamRank+=`${participant.rank}\t ${participant.winRate}\n\n`
        } else {
          redTeamSummoner+=`${participant.summonerName} -- ${participant.championId}\n\n`
          redTeamRank+=`${participant.rank}\t ${participant.winRate}\n\n`
        }
      })
      const embedMsg = new MessageEmbed()
        .setColor('#5cb357')
        .setTitle(`${name} -- Live Game ✨`)
        .addFields(
          { name: 'Blue Team', value:blueTeamSummoner, inline: true},
          { name: 'Rank/Win Rate', value:blueTeamRank, inline: true},
          { name: '\u200B', value:'\u200B'},
          { name: 'Red Team', value:redTeamSummoner, inline: true },
          { name: 'Rank/Win Rate', value:redTeamRank, inline: true}

        );
      msg.channel.send({ embeds: [embedMsg] });
    }
  } else if (message.startsWith(prefix + 'detail')){
    const name = message.substr(message.indexOf(' ')+1);
    const detailsInfo = await getDetails(name);
    if(detailsInfo.error){
      msg.channel.send(detailsInfo.msg)
    }else{
      const embedMsg = new MessageEmbed()
        .setTitle(`${name} -- General Details ✨`)
        .setColor('#5cb357')
        .addFields(
          { name: 'Rank', value: detailsInfo.summonerData.fullRank },
          { name: 'Level', value: `${detailsInfo.summonerData.level}` },
          { name: 'Win Rate', value: detailsInfo.summonerData.winRate }
        );
      msg.channel.send({ embeds: [embedMsg] });
      let matchResults='';
      detailsInfo.matchData.forEach(match => matchResults+=match.win?'Victory 🎉\n\n':'Defeat 🤕\n\n')
      let matchKDA='';
      detailsInfo.matchData.forEach(match => matchKDA+=`${match.KDA}\n\n`)
      let matchChampion='';
      detailsInfo.matchData.forEach(match => matchChampion+=`${match.championName}\n\n`)
      const embedMsgMatch = new MessageEmbed()
        .setTitle(`${name} -- Match Details ✨`)
        .setColor('#e07987')
        .addFields(
          { name: 'Result', value: matchResults, inline: true },
          { name: 'KDA', value: matchKDA, inline: true },
          { name: 'Champion', value: matchChampion, inline: true },
        );
      msg.channel.send({ embeds: [embedMsgMatch] });
    }
  }
})
client.login(process.env.TOKEN)

async function getSummonerInfo(name) {
  const res = await fetch(`https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-name/${name}?api_key=${RIOT_API}`);
  let data = await res.json();
  const resRank = await fetch(`https://na1.api.riotgames.com/lol/league/v4/entries/by-summoner/${data.id}?api_key=${RIOT_API}`);
  const dataRanks = await resRank.json();
  const soloDuoRank = dataRanks.length > 1 ? dataRanks.find(rank => rank.queueType === 'RANKED_SOLO_5x5'):dataRanks;
  console.log(dataRanks)
  console.log(soloDuoRank)
  return {
    ...data,
    ...soloDuoRank instanceof Array?soloDuoRank[0]:soloDuoRank
  };
}

async function getLive(Id) {
  const info = await getSummonerInfo(Id);
  const res = await fetch(`https://na1.api.riotgames.com/lol/spectator/v4/active-games/by-summoner/${info.id}?api_key=${RIOT_API}`);
  const data = await res.json();
  if (data.status && data.status.status_code === 404){
    return {
      error: true,
      msg: `${Id} is not in an active game`
    }
  }
  const finalData = await Promise.all(data.participants.map (async par => {
    const details = await getSummonerDetails(par.summonerName);
    return {
      isBlueTeam: par.teamId === 100 ? true : false,
      championId: par.championId,
      summonerName: par.summonerName,
      rank: details.summonerData.fullRank,
      winRate: details.summonerData.winRate
    }
  }))
  return {
    error: false,
    data: finalData
  }
}

async function getSummonerDetails(Id) {
  const info = await getSummonerInfo(Id);
  const res = await fetch(`https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${info.puuid}/ids?api_key=${RIOT_API}&type=ranked&start=0&count=10`);
  const matches = await res.json();
  if (matches.status && matches.status.status_code === 404){
    return {
      error: true,
      msg: `${Id} is not a valid league user -- please input summoner name`
    }
  }
  const summonerData = {
    level: info.summonerLevel,
    fullRank: `${info.tier} ${info.rank}`,
    winRate: Math.round(100*(info.wins/(info.wins + info.losses)))+`% (${info.wins}W ${info.losses}L)`
  }
  return{
    error: false,
    summonerData
  }
}

async function getDetails(Id) {
  const info = await getSummonerInfo(Id);
  const res = await fetch(`https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${info.puuid}/ids?api_key=${RIOT_API}&type=ranked&start=0&count=10`);
  const matches = await res.json();
  if (matches.status && matches.status.status_code === 404){
    return {
      error: true,
      msg: `${Id} is not a valid league user -- please input summoner name`
    }
  }
  console.log(info)
  const summonerData = {
    level: info.summonerLevel,
    fullRank: `${info.tier} ${info.rank}`,
    winRate: Math.round(100*(info.wins/(info.wins + info.losses)))+`% (${info.wins}W ${info.losses}L)`
  }
  const matchData = await Promise.all(matches.map(async (match) => {
    const res = await fetch(`https://americas.api.riotgames.com/lol/match/v5/matches/${match}?api_key=${RIOT_API}`);
    const matchInfo = await res.json();
    const currentIdMatchInfo = matchInfo.info.participants.find(participant => participant.summonerName.toLowerCase() === Id);

    return{
      KDA: `${currentIdMatchInfo.kills}/${currentIdMatchInfo.deaths}/${currentIdMatchInfo.assists}`,
      championName: `${currentIdMatchInfo.championName} (${getAbrrevPosition(currentIdMatchInfo.teamPosition)})`,
      win: currentIdMatchInfo.win
    }
  }))
  return{
    error: false,
    matchData: matchData,
    summonerData: summonerData
  }
}

async function getTierListBody() {
  const {tierListData} = await axios.get(url);
  return cheerio.load(tierListData.buffer.toString('utf8'));
}

async function scrapeData(lane) {
  const $ = await getTierListBody();
  //class="tabItem champion-trend-tier-TOP"  .tabItem.champion-trend-tier-${lane} tr
  const laneTierList = $(`.rt-tbody`);
  console.log(laneTierList)

  laneTierList.each((idx, el) => {
    console.log('hi')
    console.log($(el).children(".champion-index-table__cell champion-index-table__cell--champion").children(a).children('.champion-index-table__name').text())
  });
  console.log('hei')

}