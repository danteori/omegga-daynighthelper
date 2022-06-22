import OmeggaPlugin, { OL, PS, PC } from 'omegga';
import { EnvironmentPreset } from '../omegga/src/brickadia/presets';
import { BRColor } from '../onion/omegga';

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

  nightSkyIntensity:number = 7.5;
  nightSkyColor: BRColor  = {r: .133, g: 0.165, b: .376, a: 1};
  daySkyIntensity:number = 1;
  daySkyColor: BRColor = {r: 0, g: 0.171, b: 1, a: 1};
  
  msPerHour = 1000 * 75; //75000 1min15s //game hour
  msPerDayHour = this.msPerHour * 2; //hours between 6am and 6pm are twice as long
  msPerDay = (12 * this.msPerHour) + (12 * this.msPerDayHour); //27000000 45min //game day

  startSunrise = 4.8;
  sunrise = 6;
  endSunrise = 6.2;
  startSunset = 17.1;
  sunset = 18;
  endSunset = 18.6;

  startSpeed = 4;
  startBuffer = -.25;

  async init() {
    this.omegga.on('cmd:starthelper', async (speaker: string, ...args: string[]) => {
      startHelper(speaker,...args);
    });

    this.omegga.on('cmd:stophelper', (speaker: string) => {
      this.stopHelperTimeout();
      this.stopTransitionTimeout();
      Omegga.loadEnvironmentData({data:{groups:{Sky:{timeChangeSpeed: 0}}}})
    })

    const startHelper = async(speaker: string, ...args: string[]) => {
      /*
      Omegga.loadEnvironmentData({data:{groups:{Sky:{
        timeChangeSpeed: 0, 
        skyIntensity: this.daySkyIntensity, 
        skyColor: this.daySkyColor,
        timeOfDay: this.startSunset+this.startBuffer}}}})*/
      await this.getEnv();

      this.stopHelperTimeout();
      this.stopTransitionTimeout();
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
    }

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
            this.startTransition(this.env.data.groups.Sky.skyIntensity, 
              currTime < 12 ? this.daySkyIntensity : this.nightSkyIntensity,
              this.env.data.groups.Sky.skyColor,
              currTime < 12 ? this.daySkyColor : this.nightSkyColor,
              (nextTick / speed) - 20);
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

    //startHelper('orion',this.startSpeed.toString());

    return { registeredCommands: ['starthelper', 'stophelper'] };

  }

  startTransition = async (starti: number, stopi: number, startc: BRColor, stopc: BRColor, transitionTime: number) => {
    console.log(`Started a transition from ${starti} to ${stopi} over ${transitionTime}ms.`);
    //this.omegga.broadcast(`Started a transition from ${starti} to ${stopi} over ${transitionTime}ms.`);
    if(this.transitionTimeout){
      this.stopTransitionTimeout();
    }
    if(starti != stopi){
      let transitionTickRate = transitionTime/200; //50 subdivisions
      console.log(`transition tickrate: ${transitionTickRate}`);
      this.transitionTick(starti, (stopi - starti), startc, stopc, 0.0, transitionTime, transitionTickRate);
    }
  }

  transitionTick = async (starti: number, stopi: number, startc: BRColor, stopc: BRColor, x: number, transitionTime: number, tickRate: number) => {
    let intensity:number;
    let skyColor:BRColor;
    if(x < transitionTime){
    let intensityStep = this.intensityFunc(x/transitionTime);
    intensity = (intensityStep * stopi) + starti;
    skyColor = {
      r: (intensityStep * (stopc.r - startc.r)) + startc.r, 
      g: (intensityStep * (stopc.g - startc.g)) + startc.g, 
      b: (intensityStep * (stopc.b - startc.b)) + startc.b, 
      a: 1}
    this.transitionTimeout = setTimeout(async () => {await this.transitionTick(starti, stopi, startc, stopc, x + tickRate, transitionTime, tickRate);}, tickRate); 
    } else {
      intensity = (stopi + starti);
      skyColor = {
        r: stopc.r, 
        g: stopc.g, 
        b: stopc.b, 
        a: 1}
      console.log(`Day/night transition finished at sky intensity ${intensity}`);
      //this.omegga.broadcast(`Day/night transition finished at sky intensity ${intensity}`);
      this.transitionTimeout = 0;
    }
    this.loadEnvData(intensity, skyColor);
  }

  intensityFunc = (x: number):number => {
    return ((Math.atan((Math.pow(x, 2) - 0.5)*6)*0.4)+0.5)
  }

  getEnv = async () => {
    this.env = await Omegga.getEnvironmentData();
  }

  saveCurrentSky = () => {
    if(this.isDayPeak()){
      this.daySkyIntensity = this.env.data.groups.Sky.skyIntensity;
      this.daySkyColor = this.env.data.groups.Sky.skyColor;
      console.log(`Saved daytime intensity (${this.daySkyIntensity}) and color. (r${this.daySkyColor.r},g${this.daySkyColor.g},b${this.daySkyColor.b})`);
    } else if (this.isNight()){
      this.nightSkyIntensity = this.env.data.groups.Sky.skyIntensity;
      this.nightSkyColor = this.env.data.groups.Sky.skyColor;
      console.log(`Saved nighttime intensity (${this.nightSkyIntensity}) and color. (r${this.nightSkyColor.r},g${this.nightSkyColor.g},b${this.nightSkyColor.b})`);
    }
  }

  loadEnvData = (intensity: number, skyColor: BRColor) => {
    Omegga.loadEnvironmentData({data:{groups:{Sky:{skyIntensity: intensity, skyColor: skyColor}}}});
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
