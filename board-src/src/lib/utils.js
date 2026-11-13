import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The five named type tokens (src/styles.css @theme) are font sizes. twMerge cannot know that, and reads `text-title` as a colour that a later
// `text-ink` replaces, which silently dropped the dialog title to 14px. Declaring them keeps size and colour in separate groups.
const twMerge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: ['label', 'body-sm', 'body', 'title', 'marker'] }] } } });

export const cn = (...inputs) => twMerge(clsx(inputs));
