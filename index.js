// ============================================================
// 📅 SISTEMA DE HORÁRIOS
// ============================================================

let currentScheduleId = null;
let isEditMode = false;
let selectedCell = null;
let selectedColor = 'activity-color-1';

// Dias da semana e horários padrão
const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const HORARIOS_PADRAO = [
    '7:00', '8:00', '9:00', '10:00', '11:00', '12:00', 
    '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', 
    '19:00', '20:00', '21:00', '22:00'
];

// Cores disponíveis para atividades
const CORES_ATIVIDADES = [
    { id: 'activity-color-1', name: 'Azul', color: '#4fc3f7' },
    { id: 'activity-color-2', name: 'Verde', color: '#69f0ae' },
    { id: 'activity-color-3', name: 'Laranja', color: '#ffab40' },
    { id: 'activity-color-4', name: 'Vermelho', color: '#ff5252' },
    { id: 'activity-color-5', name: 'Roxo', color: '#7c4dff' },
    { id: 'activity-color-6', name: 'Amarelo', color: '#ffd740' },
    { id: 'activity-color-7', name: 'Ciano', color: '#00bcd4' },
    { id: 'activity-color-8', name: 'Coral', color: '#ff7043' }
];

// ============ FUNÇÕES DO ADM ============

async function admLoadSchedules() {
    try {
        const alunoId = document.getElementById('adm-schedule-aluno').value;
        if (!alunoId) {
            document.getElementById('adm-schedules-list').innerHTML = 
                '<p style="color:var(--text-secondary);">Selecione um aluno</p>';
            return;
        }

        const response = await fetch(`${API_URL}/schedules/aluno/${alunoId}`);
        const schedules = await response.json();

        const container = document.getElementById('adm-schedules-list');
        
        if (schedules.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);">Nenhum horário criado</p>';
            return;
        }

        container.innerHTML = schedules.map(s => `
            <div class="schedule-item ${s.id === currentScheduleId ? 'active' : ''}" 
                 onclick="admSelectSchedule('${s.id}')">
                <span class="schedule-name">📋 ${s.nome}</span>
                <span class="schedule-date">${s.created_at}</span>
                <span class="schedule-badge">${Object.keys(s.dias).length} dias</span>
                <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); admDeleteSchedule('${s.id}')">🗑️</button>
            </div>
        `).join('');

        if (schedules.length > 0 && !currentScheduleId) {
            admSelectSchedule(schedules[0].id);
        }
    } catch (error) {
        console.error('Erro ao carregar horários:', error);
    }
}

async function admCreateSchedule() {
    const alunoId = document.getElementById('adm-schedule-aluno').value;
    const nome = document.getElementById('adm-schedule-name').value.trim();

    if (!alunoId) {
        showToast('⚠️ Selecione um aluno!', 'warning');
        return;
    }
    if (!nome) {
        showToast('⚠️ Digite um nome para o horário!', 'warning');
        return;
    }

    try {
        // Criar estrutura de dias vazia
        const dias = {};
        DIAS_SEMANA.forEach(dia => {
            dias[dia] = {};
            HORARIOS_PADRAO.forEach(hora => {
                dias[dia][hora] = null;
            });
        });

        const response = await fetch(`${API_URL}/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alunoId, nome, dias })
        });

        const schedule = await response.json();
        document.getElementById('adm-schedule-name').value = '';
        await admLoadSchedules();
        admSelectSchedule(schedule.id);
        showToast('✅ Horário criado com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao criar horário:', error);
        showToast('❌ Erro ao criar horário', 'error');
    }
}

async function admSelectSchedule(scheduleId) {
    currentScheduleId = scheduleId;
    await admLoadSchedules();
    await renderScheduleGrid(scheduleId, 'adm');
}

async function admDeleteSchedule(scheduleId) {
    if (!confirm('Deseja realmente excluir este horário?')) return;

    try {
        await fetch(`${API_URL}/schedules/${scheduleId}`, { method: 'DELETE' });
        currentScheduleId = null;
        await admLoadSchedules();
        document.getElementById('adm-schedule-display').innerHTML = 
            '<p style="color:var(--text-secondary);">Selecione ou crie um horário para editar</p>';
        showToast('🗑️ Horário excluído', 'info');
    } catch (error) {
        console.error('Erro ao deletar horário:', error);
        showToast('❌ Erro ao deletar horário', 'error');
    }
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    const toggle = document.getElementById('edit-toggle');
    const label = document.getElementById('edit-mode-label');
    
    toggle.classList.toggle('active', isEditMode);
    label.textContent = isEditMode ? 'Ativado' : 'Desativado';
    
    // Recarregar o grid
    if (currentScheduleId) {
        renderScheduleGrid(currentScheduleId, 'adm');
    }
}

// ============ RENDERIZAR GRADE HORÁRIA ============

async function renderScheduleGrid(scheduleId, view = 'adm') {
    const container = document.getElementById(
        view === 'adm' ? 'adm-schedule-display' : 'aluno-schedule-display'
    );

    try {
        const response = await fetch(`${API_URL}/schedules/aluno/${currentUser.id}`);
        const schedules = await response.json();
        const schedule = schedules.find(s => s.id === scheduleId);

        if (!schedule) {
            container.innerHTML = '<p style="color:var(--text-secondary);">Horário não encontrado</p>';
            return;
        }

        const dias = schedule.dias || {};
        const isAdmin = view === 'adm';

        let html = `
            <div class="schedule-container">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <h4 style="color:var(--accent-blue);">${schedule.nome}</h4>
                    ${isAdmin ? `
                        <button class="btn btn-small btn-success" onclick="addActivity()">
                            ➕ Adicionar Atividade
                        </button>
                    ` : ''}
                </div>
                <table class="schedule-table">
                    <thead>
                        <tr>
                            <th>HORÁRIO</th>
                            ${DIAS_SEMANA.map(dia => `<th>${dia}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        HORARIOS_PADRAO.forEach(hora => {
            html += `<tr><td class="hour-cell">${hora}</td>`;
            
            DIAS_SEMANA.forEach(dia => {
                const activity = dias[dia] && dias[dia][hora];
                const hasActivity = activity && activity.nome;
                
                html += `
                    <td class="activity-cell ${hasActivity ? 'has-activity ' + (activity.cor || '') : ''}" 
                        data-dia="${dia}" 
                        data-hora="${hora}"
                        onclick="${isAdmin ? `handleCellClick('${dia}', '${hora}')` : ''}">
                        ${hasActivity ? `
                            <div class="activity-wrapper">
                                <div class="activity-name">${activity.nome}</div>
                                ${activity.materia ? `<div class="activity-subject">${activity.materia}</div>` : ''}
                                ${activity.descricao ? `<div class="activity-subject" style="font-size:9px;">${activity.descricao}</div>` : ''}
                                ${isAdmin ? `
                                    <button class="delete-activity" onclick="event.stopPropagation(); removeActivity('${dia}', '${hora}')">×</button>
                                ` : ''}
                            </div>
                        ` : (isAdmin && isEditMode ? `
                            <div style="color:var(--text-secondary);font-size:10px;opacity:0.5;">Clique para adicionar</div>
                        ` : '')}
                    </td>
                `;
            });
            
            html += `</tr>`;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;

        // Se for admin e estiver em modo de edição, mostrar o seletor de cores
        if (isAdmin && isEditMode) {
            showColorPicker();
        }

    } catch (error) {
        console.error('Erro ao renderizar grade:', error);
        container.innerHTML = '<p style="color:var(--accent-red);">Erro ao carregar grade</p>';
    }
}

// ============ FUNÇÕES DE EDIÇÃO ============

function showColorPicker() {
    // Remover picker antigo se existir
    const oldPicker = document.getElementById('color-picker-container');
    if (oldPicker) oldPicker.remove();

    const container = document.createElement('div');
    container.id = 'color-picker-container';
    container.style.cssText = `
        background: var(--bg-secondary);
        border-radius: 12px;
        padding: 12px;
        margin-bottom: 15px;
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    `;

    container.innerHTML = `
        <span style="font-size:13px;color:var(--text-secondary);">🎨 Cor da atividade:</span>
        <div class="color-picker">
            ${CORES_ATIVIDADES.map(c => `
                <div class="color-option ${c.id} ${selectedColor === c.id ? 'selected' : ''}" 
                     style="background:${c.color};" 
                     onclick="selectColor('${c.id}')"
                     title="${c.name}"></div>
            `).join('')}
        </div>
    `;

    const grid = document.querySelector('.schedule-container');
    if (grid) {
        grid.parentNode.insertBefore(container, grid);
    }
}

function selectColor(colorId) {
    selectedColor = colorId;
    document.querySelectorAll('.color-option').forEach(el => {
        el.classList.toggle('selected', el.className.includes(colorId));
    });
}

async function handleCellClick(dia, hora) {
    if (!isEditMode) {
        showToast('ℹ️ Ative o modo de edição para modificar', 'info');
        return;
    }

    selectedCell = { dia, hora };
    
    // Mostrar modal para adicionar atividade
    document.getElementById('activity-dia').textContent = dia;
    document.getElementById('activity-hora').textContent = hora;
    document.getElementById('activity-modal').classList.remove('hidden');
}

async function addActivity() {
    const nome = document.getElementById('activity-nome').value.trim();
    const materia = document.getElementById('activity-materia').value.trim();
    const descricao = document.getElementById('activity-descricao').value.trim();

    if (!selectedCell) {
        showToast('⚠️ Selecione uma célula!', 'warning');
        return;
    }

    if (!nome) {
        showToast('⚠️ Digite o nome da atividade!', 'warning');
        return;
    }

    try {
        // Buscar o schedule atual
        const response = await fetch(`${API_URL}/schedules/aluno/${currentUser.id}`);
        const schedules = await response.json();
        const schedule = schedules.find(s => s.id === currentScheduleId);

        if (!schedule) {
            showToast('❌ Horário não encontrado', 'error');
            return;
        }

        // Atualizar os dias
        const dias = schedule.dias || {};
        const { dia, hora } = selectedCell;
        
        if (!dias[dia]) dias[dia] = {};
        
        dias[dia][hora] = {
            nome,
            materia: materia || '',
            descricao: descricao || '',
            cor: selectedColor
        };

        // Salvar no banco
        await fetch(`${API_URL}/schedules/${currentScheduleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome: schedule.nome, dias })
        });

        // Fechar modal
        closeActivityModal();
        
        // Recarregar grade
        await renderScheduleGrid(currentScheduleId, 'adm');
        showToast('✅ Atividade adicionada!', 'success');

    } catch (error) {
        console.error('Erro ao adicionar atividade:', error);
        showToast('❌ Erro ao adicionar atividade', 'error');
    }
}

async function removeActivity(dia, hora) {
    if (!confirm(`Remover atividade de ${dia} às ${hora}?`)) return;

    try {
        const response = await fetch(`${API_URL}/schedules/aluno/${currentUser.id}`);
        const schedules = await response.json();
        const schedule = schedules.find(s => s.id === currentScheduleId);

        if (!schedule) {
            showToast('❌ Horário não encontrado', 'error');
            return;
        }

        const dias = schedule.dias || {};
        if (dias[dia] && dias[dia][hora]) {
            dias[dia][hora] = null;
        }

        await fetch(`${API_URL}/schedules/${currentScheduleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome: schedule.nome, dias })
        });

        await renderScheduleGrid(currentScheduleId, 'adm');
        showToast('🗑️ Atividade removida', 'info');

    } catch (error) {
        console.error('Erro ao remover atividade:', error);
        showToast('❌ Erro ao remover atividade', 'error');
    }
}

function closeActivityModal() {
    document.getElementById('activity-modal').classList.add('hidden');
    document.getElementById('activity-nome').value = '';
    document.getElementById('activity-materia').value = '';
    document.getElementById('activity-descricao').value = '';
    selectedCell = null;
}

// ============ FUNÇÕES DO ALUNO ============

async function alunoLoadSchedules() {
    try {
        const response = await fetch(`${API_URL}/schedules/aluno/${currentUser.id}`);
        const schedules = await response.json();

        const container = document.getElementById('aluno-schedules-list');
        
        if (schedules.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);">Nenhum horário disponível</p>';
            return;
        }

        container.innerHTML = schedules.map(s => `
            <div class="schedule-item ${s.id === currentScheduleId ? 'active' : ''}" 
                 onclick="alunoSelectSchedule('${s.id}')">
                <span class="schedule-name">📋 ${s.nome}</span>
                <span class="schedule-date">${s.created_at}</span>
                <span class="schedule-badge">${Object.keys(s.dias).length} dias</span>
            </div>
        `).join('');

        if (schedules.length > 0 && !currentScheduleId) {
            alunoSelectSchedule(schedules[0].id);
        }
    } catch (error) {
        console.error('Erro ao carregar horários:', error);
    }
}

async function alunoSelectSchedule(scheduleId) {
    currentScheduleId = scheduleId;
    await alunoLoadSchedules();
    await renderScheduleGrid(scheduleId, 'aluno');
}
