import OmeggaPlugin, { OL, PS, PC } from 'omegga';
import { EnvironmentPreset } from '../omegga/src/brickadia/presets';

type Config = { foo: string };
type Storage = { bar: string };

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
  }

  helperTimeout:number;
  transitionTimeout:number;
  env:EnvironmentPreset;

  nightSkyIntensity = 7.5;
  daySkyIntensity = 1;
  
  msPerHour = 1000 * 75; //75000 1min15s //game hour
  msPerDayHour = this.msPerHour * 2; //hours between 6am and 6pm are twice as long
  msPerDay = (12 * this.msPerHour) + (12 * this.msPerDayHour); //27000000 45min //game day

  startSunrise = 4.4;
  sunrise = 6;
  endSunrise = 6.1;
  startSunset = 17.1;
  sunset = 18;
  endSunset = 18.6;

  async init() {
    // Write your plugin!
    this.omegga.on('cmd:starthelper', async (speaker: string, ...args: string[]) => {
      Omegga.loadEnvironmentData({data:{groups:{Sky:{
        timeChangeSpeed: 0, 
        skyIntensity: this.nightSkyIntensity, 
        timeOfDay: this.startSunrise-.5}}}})
      await this.getEnv();

      this.stopHelperTimeout();
      if(args.length){
        let multiplier = parseInt(args[0]);
        if(!isNaN(multiplier)){
          Omegga.loadEnvironmentData({data:{groups:{Sky:{timeChangeSpeed: multiplier}}}})
          console.log(`daynighthelper started by ${speaker} at ${multiplier}x speed`);
        }
      } else if(this.env.data.groups.Sky.timeChangeSpeed < 1){
          Omegga.loadEnvironmentData({data:{groups:{Sky:{timeChangeSpeed: 1}}}})
          console.log(`daynighthelper started by ${speaker} at ${1}x speed`);
      } else {
        console.log(`daynighthelper started by ${speaker} at ${this.env.data.groups.Sky.timeChangeSpeed}x speed`);
      }
      await helperTick();
    });

    this.omegga.on('cmd:stophelper', (speaker: string) => {
      console.log(`Stopped daynighthelper.`);
      this.stopHelperTimeout();
      this.stopTransitionTimeout();
      Omegga.loadEnvironmentData({data:{groups:{Sky:{timeChangeSpeed: 0}}}})
    })

    const helperTick = async () => {
      await this.getEnv();
      let currTime = this.env.data.groups.Sky.timeOfDay;
      let speed = this.env.data.groups.Sky.timeChangeSpeed;
      let nextTick;

      if(speed > 0){
        if(!this.isNight()){ //daytime
          if(this.isDayPeak()){ //peak hours where light is constant
            console.log('peak');
            nextTick = (this.msPerDayHour * (this.startSunset - currTime)) + 10
          } else { //transition period
            //start env transition
            console.log('transition');
            this.saveCurrentSky();
            nextTick = (this.twoHoursToMs(currTime, currTime < 12 ? this.endSunrise : this.endSunset)) + 10
            this.startTransition(this.env.data.groups.Sky.skyIntensity, currTime < 12 ? this.daySkyIntensity : this.nightSkyIntensity, (nextTick / speed) - 20);
          }
        } else { //night
          console.log('night');
          if(currTime > this.endSunset){ 
            nextTick = (this.msPerHour * (24 - currTime)) + 10 //cut at midnight
          } else if (currTime < this.startSunrise) {
            nextTick = (this.msPerHour * (this.startSunrise - currTime)) + 10 //cut at sunrise
          } else {
            nextTick = this.msPerHour * nextTick;
          }
        }

        nextTick /= speed;
      
        console.log(`time - ${currTime}, speed - ${speed}
        tickTime - ${nextTick}`);
        this.helperTimeout = setTimeout(async () => {await helperTick();}, nextTick);
      } else {
        console.log(`daynight helper halted due to timechangespeed being set to 0`);
      }
    }

    return { registeredCommands: ['starthelper', 'stophelper'] };

  }

  startTransition = async (starti: number, stopi: number, transitionTime: number) => {
    console.log(`Started a transition from ${starti} to ${stopi} over ${transitionTime}ms.`);
    if(this.transitionTimeout){
      this.stopTransitionTimeout();
    }
    if(starti != stopi){
      let transitionTickRate = transitionTime/50; //50 subdivisions
      console.log(`transition tickrate: ${transitionTickRate}`);
      this.transitionTick(starti, (stopi - starti), 0.0, transitionTime, transitionTickRate);
    }
  }

  transitionTick = async (starti: number, stopi: number, x: number, transitionTime: number, tickRate: number) => {
    let intensity:number;
    if(x < transitionTime){
    intensity = (((Math.atan((Math.pow(x/transitionTime, 2) - 0.5)*6)*0.4)+0.5) * stopi) + starti;
    this.transitionTimeout = setTimeout(async () => {await this.transitionTick(starti, stopi, x + tickRate, transitionTime, tickRate);}, tickRate); 
    } else {
      intensity = (stopi + starti);
      console.log(`Day/night transition finished at sky intensity ${intensity}`);
      this.transitionTimeout = 0;
    }
    this.loadEnvData(intensity);
  }

  getEnv = async () => {
    console.log("getting env")
    let start = new Date();
    this.env = await Omegga.getEnvironmentData();
    let end = new Date();
    console.log(`finished getting env in ${end.getTime() - start.getTime()}ms`)
  }

  saveCurrentSky = () => {
    if(this.isDayPeak()){
      this.daySkyIntensity = this.env.data.groups.Sky.skyIntensity;
      console.log(`Saved day intensity as ${this.daySkyIntensity}`);
    } else if (this.isNight()){
      this.nightSkyIntensity = this.env.data.groups.Sky.skyIntensity;
      console.log(`Saved night intensity as ${this.nightSkyIntensity}`);
    }
  }

  loadEnvData = (intensity: number) => {
    Omegga.loadEnvironmentData({data:{groups:{Sky:{skyIntensity: intensity}}}});
  }

  isDayPeak = ():boolean => {
    return this.env.data.groups.Sky.timeOfDay >= this.endSunrise && this.env.data.groups.Sky.timeOfDay < this.startSunset;
  }

  isNight = ():boolean => {
    return this.env.data.groups.Sky.timeOfDay >= this.endSunset || this.env.data.groups.Sky.timeOfDay < this.startSunrise;
  }

  hourToMs = (x: number):number => {
    let ms = 0;
    if(x > 18){
      ms += ((x - 18) * this.msPerHour);
      x = 18;
    }
    if(x > 6){
      ms += ((x - 6) * this.msPerDayHour);
      x = 6;
    }
    ms += (x * this.msPerHour);
    return ms;
  }

  twoHoursToMs = (first: number, second: number): number => {
    return this.hourToMs(second) - this.hourToMs(first);
  }

  stopHelperTimeout = () => {
    if(this.helperTimeout){
      clearTimeout(this.helperTimeout);
      this.helperTimeout = 0;
      console.log(`daynighthelper stopped.`);
    }
  }

  stopTransitionTimeout = () => {
    if(this.transitionTimeout){
      clearTimeout(this.transitionTimeout);
      this.transitionTimeout = 0;
      console.log(`daynighthelper transition stopped.`);
    }
  }

  async stop() {
    this.stopHelperTimeout();
    this.stopTransitionTimeout();
    console.log(`daynighthelper plugin stopped.`);
  }
}
