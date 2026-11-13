import { createContext, useContext } from 'react';

// Where floating layers (dialog, select, popover, tooltip) mount. Default is document.body; the style guide
// sets one container per theme panel so both themes can show open layers side by side.
export const PortalContainer = createContext(undefined);
export const usePortalContainer = () => useContext(PortalContainer);
