import { Game } from "./core/Game";


const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

new Game(canvas, uiRoot);