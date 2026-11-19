// Guitar setup + string maintenance shared helpers.
// Loaded by index.html (dynamic widget) and manager.html (Guitars tab).
(function (GPH) {
    'use strict';

    const TYPE_LABELS = {
        electric: 'Electric', acoustic: 'Acoustic', classical: 'Classical',
        bass: 'Bass', twelve: '12-string', other: 'Other'
    };
    const DEFAULT_STRINGS = {
        electric: 6, acoustic: 6, classical: 6, bass: 4, twelve: 12, other: 6
    };
    const ERROR_TEXT = {
        missing_name: 'Give the guitar a name.',
        name_exists: 'That name is already in use.',
        bad_type: 'Choose a valid guitar type.',
        bad_string_count: 'String count must be between 1 and 24.',
        bad_color: 'Choose a valid colour.',
        string_count_locked: 'The string count cannot change once the guitar has history.',
        has_history: 'This guitar has history. Archive it instead of deleting it.',
        bad_date: 'Choose a valid date. Future dates are not allowed.',
        missing_model: 'The string model is required for a full set.',
        missing_strings: 'Select at least one string for a partial change.',
        all_strings: 'For a partial change select fewer than all strings.',
        bad_strings: 'One or more selected strings are invalid.',
        not_active: 'Archived guitars cannot receive new changes.'
    };

    function api(method, path, body) {
        const opts = { method: method, headers: {} };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        return fetch(path, opts).then(function (r) {
            return r.json().catch(function () { return null; }).then(function (data) {
                if (!r.ok) {
                    const err = new Error((data && data.error) || ('HTTP ' + r.status));
                    err.status = r.status;
                    err.payload = data;
                    throw err;
                }
                return data;
            });
        });
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function todayIso() {
        const d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function parseIso(iso) {
        if (!iso) return null;
        const p = String(iso).slice(0, 10).split('-');
        if (p.length !== 3) return null;
        const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        return isNaN(d.getTime()) ? null : d;
    }

    function daysSince(iso) {
        const d = parseIso(iso);
        if (!d) return null;
        const today = parseIso(todayIso());
        return Math.max(0, Math.floor((today - d) / 86400000));
    }

    // < 30 days: days; otherwise months + leftover days (omit a zero remainder).
    function formatElapsed(days) {
        if (days == null || isNaN(days)) return '\u2014';
        const d = Math.max(0, Math.floor(days));
        if (d < 30) return d + (d === 1 ? ' day' : ' days');
        const months = Math.floor(d / 30);
        const rest = d % 30;
        let out = months + (months === 1 ? ' month' : ' months');
        if (rest) out += ' ' + rest + (rest === 1 ? ' day' : ' days');
        return out;
    }

    function formatDate(iso) {
        const d = parseIso(iso);
        if (!d) return '\u2014';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function statusFor(guitar) {
        if (!guitar || !guitar.last_full_date) {
            return { text: 'No full set yet', days: null, tone: 'warn' };
        }
        const days = daysSince(guitar.last_full_date);
        let tone = 'good';
        if (days >= 60) tone = 'bad';
        else if (days >= 30) tone = 'warn';
        return { text: formatElapsed(days) + ' ago', days: days, tone: tone };
    }

    function stringsLabel(arr) {
        if (!arr || !arr.length) return '';
        return arr.map(function (n) { return 'S' + n; }).join(', ');
    }

    function errorText(code) {
        return ERROR_TEXT[code] || ('Could not save: ' + code);
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function listGuitars(includeArchived) {
        return api('GET', '/api/guitars' + (includeArchived ? '?include_archived=1' : ''));
    }

    function getModels() { return api('GET', '/api/string-models'); }
    function getChanges(guitarId, limit, offset) {
        let url = '/api/guitars/' + guitarId + '/changes';
        const params = [];
        if (limit != null) params.push('limit=' + encodeURIComponent(limit));
        if (offset != null) params.push('offset=' + encodeURIComponent(offset));
        if (params.length) url += '?' + params.join('&');
        return api('GET', url);
    }

    function changeModalHtml(guitar, change, kind, date) {
        const count = Math.max(1, Number(guitar.string_count) || 6);
        const picked = (change && change.changed_strings) || [];
        let chips = '';
        for (let i = 1; i <= count; i++) {
            chips += '<label class="gc-chip"><input type="checkbox" value="' + i + '"' +
                (picked.indexOf(i) >= 0 ? ' checked' : '') + '><span>S' + i + '</span></label>';
        }
        return '<div class="gc-modal" role="dialog" aria-modal="true" aria-labelledby="gcModalTitle">' +
            '<div class="gc-modal-head">' +
                '<h3 id="gcModalTitle">' + (change ? 'Edit string change' : 'Register string change') + '</h3>' +
                '<button type="button" class="gc-x" aria-label="Close">&times;</button>' +
            '</div>' +
            '<form class="gc-form">' +
                '<div class="gc-guitar-line"><span class="gc-color-dot" style="background:' +
                    esc(guitar.color_hex) + '"></span><b>' + esc(guitar.name) + '</b>' +
                    '<span class="gc-muted">' + count + ' strings</span></div>' +
                '<div class="gc-row">' +
                    '<label class="gc-field"><span>Date</span><input type="date" name="date" max="' +
                        todayIso() + '" required value="' +
                        esc((change && change.date) || date || todayIso()) + '"></label>' +
                    '<label class="gc-field"><span>Type</span><select name="type">' +
                        '<option value="full"' + (kind === 'full' ? ' selected' : '') + '>Full set</option>' +
                        '<option value="partial"' + (kind === 'partial' ? ' selected' : '') + '>Partial</option>' +
                    '</select></label>' +
                '</div>' +
                '<div class="gc-strings" hidden><span class="gc-label">Strings changed</span>' +
                    '<div class="gc-chips">' + chips + '</div></div>' +
                '<label class="gc-field"><span class="gc-model-label">String model *</span>' +
                    '<input type="text" name="string_model" maxlength="200" autocomplete="off" ' +
                    'list="guitarsModelList" value="' +
                    esc((change && change.string_model) || '') + '"></label>' +
                '<datalist id="guitarsModelList"></datalist>' +
                '<label class="gc-field"><span>Notes</span><textarea name="notes" rows="2" ' +
                    'maxlength="2000">' + esc((change && change.notes) || '') + '</textarea></label>' +
                '<div class="gc-error" hidden></div>' +
                '<div class="gc-actions">' +
                    '<button type="button" class="gc-btn gc-cancel">Cancel</button>' +
                    '<button type="submit" class="gc-btn gc-save">' +
                        (change ? 'Save change' : 'Register change') + '</button>' +
                '</div>' +
            '</form>' +
        '</div>';
    }

    GPH.guitars = {
        TYPE_LABELS: TYPE_LABELS,
        DEFAULT_STRINGS: DEFAULT_STRINGS,
        api: api, todayIso: todayIso, parseIso: parseIso, daysSince: daysSince,
        formatElapsed: formatElapsed, formatDate: formatDate, statusFor: statusFor,
        stringsLabel: stringsLabel, errorText: errorText, esc: esc,
        listGuitars: listGuitars, getModels: getModels, getChanges: getChanges
    };
    function openChangeDialog(opts) {
        opts = opts || {};
        const change = opts.change || null;
        const guitarPromise = opts.guitar ? Promise.resolve(opts.guitar)
            : api('GET', '/api/guitars/' + (opts.guitarId || (change && change.guitar_id)));
        return guitarPromise.then(function (guitar) {
            if (!guitar || document.getElementById('guitarsChangeModal')) return;
            const kind = (change && change.type) || opts.type || 'full';
            const overlay = document.createElement('div');
            overlay.id = 'guitarsChangeModal';
            overlay.className = 'gc-modal-backdrop';
            overlay.innerHTML = changeModalHtml(guitar, change, kind, opts.date);
            document.body.appendChild(overlay);

            const form = overlay.querySelector('.gc-form');
            const typeSel = form.querySelector('[name="type"]');
            const stringsBox = overlay.querySelector('.gc-strings');
            const modelInput = form.querySelector('[name="string_model"]');
            const modelLabel = overlay.querySelector('.gc-model-label');
            const errBox = overlay.querySelector('.gc-error');
            const saveBtn = overlay.querySelector('.gc-save');

            function syncType() {
                const full = typeSel.value === 'full';
                stringsBox.hidden = full;
                modelInput.required = full;
                modelLabel.textContent = full ? 'String model *' : 'String model (optional)';
            }
            function close() {
                overlay.remove();
                document.removeEventListener('keydown', escClose);
            }
            function fail(message) {
                errBox.textContent = message;
                errBox.hidden = false;
            }
            syncType();
            typeSel.addEventListener('change', syncType);
            overlay.querySelector('.gc-x').addEventListener('click', close);
            overlay.querySelector('.gc-cancel').addEventListener('click', close);
            overlay.addEventListener('mousedown', function (ev) {
                if (ev.target === overlay) close();
            });
            function escClose(ev) {
                if (ev.key === 'Escape') {
                    close();
                    document.removeEventListener('keydown', escClose);
                }
            }
            document.addEventListener('keydown', escClose);

            getModels().then(function (models) {
                const dl = overlay.querySelector('#guitarsModelList');
                if (!dl) return;
                (models || []).forEach(function (m) {
                    const o = document.createElement('option');
                    o.value = m.value;
                    o.label = m.use_count + ' use' + (m.use_count === 1 ? '' : 's');
                    dl.appendChild(o);
                });
            }).catch(function () {});

            form.addEventListener('submit', function (ev) {
                ev.preventDefault();
                errBox.hidden = true;
                const type = typeSel.value;
                const changed = Array.prototype.slice.call(
                    form.querySelectorAll('.gc-chip input:checked')
                ).map(function (el) { return Number(el.value); });
                const payload = {
                    date: form.querySelector('[name="date"]').value,
                    type: type,
                    changed_strings: type === 'partial' ? changed : [],
                    string_model: modelInput.value.trim(),
                    notes: form.querySelector('[name="notes"]').value
                };
                saveBtn.disabled = true;
                const req = change
                    ? api('PUT', '/api/string-changes/' + change.id, payload)
                    : api('POST', '/api/guitars/' + guitar.id + '/changes', payload);
                req.then(function (saved) {
                    close();
                    if (typeof opts.onSaved === 'function') opts.onSaved(saved);
                }).catch(function (err) {
                    saveBtn.disabled = false;
                    fail(errorText((err.payload && err.payload.error) || err.message));
                });
            });
        });
    }

    GPH.guitars.openChangeDialog = openChangeDialog;
})(window.GPH = window.GPH || {});
