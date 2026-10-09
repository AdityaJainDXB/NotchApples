// What an Ultimate tab shows in a build made from the public source code, which doesn't include the Ultimate modules
// (they live in a private repository and are built into the official releases only).
import { el } from '../store.js';
import { empty } from '../ui.js';

const NAMES = { convert: 'Convert', doit: 'Do It', smarthome: 'Smart Home', claudeusage: 'Claude Usage' };

export function render(root, id) {
  root.append(empty('🔒', `${NAMES[id] || 'This tab'} is in the official Ultimate build`,
    "This copy of Notch apple was built from the public source code, which doesn't include the Ultimate modules. Get the official app from the website."));
}
