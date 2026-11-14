// Minimal inline SVG icon set shared by the app and the manager.
// Usage: GPH.icons.get('play') -> '<svg class="ico" …>…</svg>' (inherits color/size).
(function (GPH) {
    'use strict';

    const PATHS = {
        play: '<path d="M8 5.4v13.2L19 12z" fill="currentColor" stroke="none"/>',
        pause: '<rect x="7" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.4" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>',
        stop: '<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2" fill="currentColor" stroke="none"/>',
        prev: '<path d="M6.4 5v14"/><path d="M18.4 5.4v13.2L9.1 12z" fill="currentColor" stroke="none"/>',
        next: '<path d="M17.6 5v14"/><path d="M5.6 5.4v13.2L14.9 12z" fill="currentColor" stroke="none"/>',
        check: '<path d="M5 12.6l4.2 4.2L19 7"/>',
        chevrons: '<path d="M7.6 6.6L13 12l-5.4 5.4"/><path d="M13.4 6.6L18.8 12l-5.4 5.4"/>',
        'check-box': '<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3"/><path d="M8 12.3l2.9 2.9 5.4-5.6"/>',
        box: '<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3"/>',
        clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.2 2"/>',
        clipboard: '<rect x="4.8" y="4.6" width="14.4" height="14.6" rx="2.2"/><path d="M9.2 4.6V3.4h5.6v1.2"/><path d="M8.6 10.4h6.8M8.6 13.8h6.8M8.6 17.2h4.2"/>',
        alert: '<path d="M12 4.4l8.3 14.4H3.7z"/><path d="M12 9.6v4"/><circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none"/>',
        external: '<path d="M13.4 4.6h6v6"/><path d="M19.4 4.6l-8.6 8.6"/><path d="M18.4 14.2V18a1.6 1.6 0 0 1-1.6 1.6H5.8A1.6 1.6 0 0 1 4.2 18V7.2a1.6 1.6 0 0 1 1.6-1.6H9.4"/>',
        video: '<rect x="3" y="6.2" width="18" height="11.6" rx="3.2"/><path d="M10.4 9.6l4.8 2.4-4.8 2.4z" fill="currentColor" stroke="none"/>',
        file: '<path d="M6.6 3.6h6.6l4.2 4.2v12.6H6.6z"/><path d="M13.2 3.6v4.2h4.2"/>',
        globe: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c3 2.6 3 13.8 0 16.4"/><path d="M12 3.8c-3 2.6-3 13.8 0 16.4"/>',
        music: '<circle cx="8.2" cy="17" r="2.5"/><circle cx="17.2" cy="14.8" r="2.5"/><path d="M10.7 17V7.4l9-1.9v9.3"/>',
        grip: '<circle cx="9" cy="6.4" r="1.35" fill="currentColor" stroke="none"/><circle cx="15" cy="6.4" r="1.35" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="9" cy="17.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="15" cy="17.6" r="1.35" fill="currentColor" stroke="none"/>',

        // Metronome click patterns. Note heads are filled and the stems/beams
        // keep the shared 1.8 stroke, so they read well at button size.
        'note-quarter': '<path d="M14 18V6" stroke-width="1.8" stroke-linecap="butt"/><ellipse cx="12" cy="18" rx="3.2" ry="2.4" transform="rotate(-20 12 18)" fill="currentColor" stroke="none"/>',
        'note-eighths': '<path d="M8.63 18V8.4M18.63 18V8.4" stroke-width="1.8" stroke-linecap="butt"/><path d="M7.73 6.2H19.53V8.4H7.73Z" fill="currentColor" stroke="none"/><ellipse cx="7" cy="18" rx="2.8" ry="2.1" transform="rotate(-20 7 18)" fill="currentColor" stroke="none"/><ellipse cx="17" cy="18" rx="2.8" ry="2.1" transform="rotate(-20 17 18)" fill="currentColor" stroke="none"/>',
        'note-sixteenths': '<path d="M4.71 18V7.6M10.41 18V7.6M16.11 18V7.6M21.81 18V7.6" stroke-width="1.8" stroke-linecap="butt"/><path d="M3.81 6H22.71V7.6H3.81Z" fill="currentColor" stroke="none"/><path d="M3.81 9.2H22.71V10.8H3.81Z" fill="currentColor" stroke="none"/><ellipse cx="3.5" cy="18" rx="2.35" ry="1.78" transform="rotate(-20 3.5 18)" fill="currentColor" stroke="none"/><ellipse cx="9.2" cy="18" rx="2.35" ry="1.78" transform="rotate(-20 9.2 18)" fill="currentColor" stroke="none"/><ellipse cx="14.9" cy="18" rx="2.35" ry="1.78" transform="rotate(-20 14.9 18)" fill="currentColor" stroke="none"/><ellipse cx="20.6" cy="18" rx="2.35" ry="1.78" transform="rotate(-20 20.6 18)" fill="currentColor" stroke="none"/>',
        'note-triplets': '<path d="M8.4 18V8.6M13.4 18V8.6M18.4 18V8.6" stroke-width="1.8" stroke-linecap="butt"/><path d="M7.5 6.6H19.3V8.6H7.5Z" fill="currentColor" stroke="none"/><text x="13.4" y="5.4" text-anchor="middle" font-family="Segoe UI, Tahoma, sans-serif" font-size="6.5" font-weight="700" fill="currentColor" stroke="none">3</text><ellipse cx="7.05" cy="18" rx="2.5" ry="1.9" transform="rotate(-20 7.05 18)" fill="currentColor" stroke="none"/><ellipse cx="12.05" cy="18" rx="2.5" ry="1.9" transform="rotate(-20 12.05 18)" fill="currentColor" stroke="none"/><ellipse cx="17.05" cy="18" rx="2.5" ry="1.9" transform="rotate(-20 17.05 18)" fill="currentColor" stroke="none"/>',
        'note-shuffle': '<path d="M7.5 18V9M19.5 18V9" stroke-width="1.8" stroke-linecap="butt"/><path d="M19.5 9c2.2 0.7 3 2.3 2.6 4.1"/><path d="M6.2 7.2V5.8H20.5V7.2"/><text x="13.35" y="5" text-anchor="middle" font-family="Segoe UI, Tahoma, sans-serif" font-size="6.2" font-weight="700" fill="currentColor" stroke="none">3</text><ellipse cx="5.87" cy="18" rx="2.8" ry="2.1" transform="rotate(-20 5.87 18)" fill="currentColor" stroke="none"/><ellipse cx="18.06" cy="18" rx="2.6" ry="2" transform="rotate(-20 18.06 18)" fill="currentColor" stroke="none"/>',

        // Accent on beat 1: a bold "1" with a burst. The rays are hidden by CSS
        // when the toggle is off, leaving just the plain "1".
        'accent-one': '<g class="accent-rays" stroke-width="1.5"><path d="M12 1.8V3.8M19.2 4.8L17.8 6.2M22.2 12H20.2M19.2 19.2L17.8 17.8M12 22.2V20.2M4.8 19.2L6.2 17.8M1.8 12H3.8M4.8 4.8L6.2 6.2"/></g><path d="M10.3 9.4L12.1 8V16M10 16H14.2" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter"/>'
    };

    function get(name, cls) {
        const body = PATHS[name];
        if (!body) return '';
        return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none"' +
            ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' +
            ' aria-hidden="true">' + body + '</svg>';
    }

    GPH.icons = { get: get };
})(window.GPH = window.GPH || {});
