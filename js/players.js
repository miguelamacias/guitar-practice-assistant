// Reproductor MP3 flotante + modal incrustado de YouTube.
(function (GPH) {
    'use strict';

    // Tracks shorter than two minutes are practice loops: loop is ON by default.
    const SHORT_TRACK_SECONDS = 120;
    let loopOverride = false;

    function getAudioEl() { return document.getElementById('audioPlayer'); }
    function getTitleEl() { return document.getElementById('current-playing'); }

    function syncLoopButton() {
        const player = getAudioEl();
        const btn = document.getElementById('apLoop');
        if (!player || !btn) return;
        const on = !!player.loop;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.disabled = !player.getAttribute('src');
        btn.title = 'Loop: ' + (on ? 'on' : 'off');
    }

    function playAudio(url, title) {
        closeYouTube();

        const player = getAudioEl();
        const titleSpan = getTitleEl();

        loopOverride = false;
        player.loop = false;
        player.src = url;
        titleSpan.textContent = title;
        const panel = document.getElementById('audioPanel');
        if (panel) panel.classList.add('is-open');
        if (GPH.scrobbler && GPH.scrobbler.start) GPH.scrobbler.start(url, title);
        player.play();
        syncLoopButton();
        setTimeout(updateMarquee, 30);
    }

    function openYouTube(videoId, title, originalUrl) {
        const audioPlayer = getAudioEl();
        if (audioPlayer) audioPlayer.pause();
        const apanel = document.getElementById('audioPanel');
        if (apanel) apanel.classList.remove('is-open');

        const modal = document.getElementById('youtubeModal');
        const iframe = document.getElementById('ytIframe');
        const titleSpan = document.getElementById('ytModalTitle');
        const externalLink = document.getElementById('ytExternalLink');

        externalLink.href = originalUrl || ('https://www.youtube.com/watch?v=' + videoId);
        iframe.src = 'https://www.youtube.com/embed/' + videoId + '?autoplay=1';
        titleSpan.textContent = title;
        modal.classList.add('is-open');
    }

    function closeYouTube() {
        const modal = document.getElementById('youtubeModal');
        const iframe = document.getElementById('ytIframe');
        if (iframe) iframe.src = '';
        if (modal) modal.classList.remove('is-open');
    }

    function getYouTubeId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function closeAudio() {
        const player = getAudioEl();
        if (player) {
            player.pause();
            player.removeAttribute('src');
            player.load();
            player.loop = false;
        }
        loopOverride = false;
        syncLoopButton();
        if (GPH.scrobbler && GPH.scrobbler.stop) GPH.scrobbler.stop();
        const titleSpan = getTitleEl();
        if (titleSpan) { titleSpan.textContent = 'No audio selected'; titleSpan.classList.remove('scrolling'); titleSpan.style.removeProperty('--shift'); }
        const panel = document.getElementById('audioPanel');
        if (panel) panel.classList.remove('is-open');
        const seek = document.getElementById('apSeek'); if (seek) seek.value = 0;
        const time = document.getElementById('apTime'); if (time) time.textContent = '0:00';
        const pb = document.getElementById('apPlay'); if (pb) pb.classList.remove('is-playing');
    }

    function fmtTime(s) {
        if (!isFinite(s) || s < 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + String(sec).padStart(2, '0');
    }

    function updateMarquee() {
        const wrap = document.querySelector('.audio-title-wrap');
        const text = getTitleEl();
        if (!wrap || !text) return;
        text.classList.remove('scrolling');
        text.style.removeProperty('--shift');
        text.style.removeProperty('--dur');
        const cw = wrap.clientWidth;
        const tw = text.scrollWidth;
        if (cw > 0 && tw > cw + 2) {
            const dist = tw - cw;
            text.style.setProperty('--shift', '-' + dist + 'px');
            text.style.setProperty('--dur', Math.max(6, dist / 30 + 4) + 's');
            text.classList.add('scrolling');
        }
    }

    function initAudioControls() {
        const player = getAudioEl();
        const playBtn = document.getElementById('apPlay');
        const seek = document.getElementById('apSeek');
        const time = document.getElementById('apTime');
        if (!player || !playBtn || !seek) return;
        playBtn.addEventListener('click', function () {
            if (player.paused) { player.play(); } else { player.pause(); }
        });
        const loopBtn = document.getElementById('apLoop');
        if (loopBtn) {
            loopBtn.addEventListener('click', function () {
                if (!player.getAttribute('src')) return;
                player.loop = !player.loop;
                loopOverride = true;
                syncLoopButton();
            });
        }
        player.addEventListener('play', function () { playBtn.classList.add('is-playing'); });
        player.addEventListener('pause', function () { playBtn.classList.remove('is-playing'); });
        player.addEventListener('timeupdate', function () {
            if (player.duration) {
                seek.value = Math.floor((player.currentTime / player.duration) * 1000);
                time.textContent = fmtTime(player.currentTime) + ' / ' + fmtTime(player.duration);
            }
        });
        player.addEventListener('loadedmetadata', function () {
            seek.value = 0;
            time.textContent = '0:00 / ' + fmtTime(player.duration);
            if (!loopOverride && isFinite(player.duration) && player.duration > 0) {
                player.loop = player.duration < SHORT_TRACK_SECONDS;
            }
            syncLoopButton();
        });
        player.addEventListener('emptied', syncLoopButton);
        seek.addEventListener('input', function () {
            if (player.duration) player.currentTime = (seek.value / 1000) * player.duration;
        });
        syncLoopButton();
    }

    document.addEventListener('DOMContentLoaded', initAudioControls);

    GPH.players = { playAudio, openYouTube, closeYouTube, getYouTubeId, closeAudio };
})(window.GPH = window.GPH || {});
