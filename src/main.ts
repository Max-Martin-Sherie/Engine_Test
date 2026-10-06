import { boot } from './engine';
import { createGame } from './game';

// A landscape play field, with a transparent 2D layer over the game's own 3D canvas.
boot(createGame, { orientation: 'landscape', transparent: true });
