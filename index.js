// ============================================================
// 🎯 ATUALIZAR STATUS DA TAREFA PELA GRADE
// ============================================================

async function updateTaskFromSchedule(taskId, newStatus) {
    if (isUpdating) {
        showToast('⏳ Aguarde, processando...', 'warning');
        return;
    }
    
    try {
        isUpdating = true;
        const taskIdStr = String(taskId);
        
        console.log(`🔄 Atualizando tarefa ${taskIdStr} para "${newStatus}" via grade`);
        
        showToast('⏳ Atualizando status...', 'info');
        
        const response = await fetch(`${API_URL}/tasks/${taskIdStr}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                status: newStatus, 
                justification: '',
                alunoId: currentUser.id 
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao atualizar status');
        }
        
        const data = await response.json();
        console.log('✅ Resposta:', data);
        
        if (data.success) {
            await loadAlunoData();
            updateAlunoXP();
            await checkAchievements();
            
            // Recarregar grade e tarefas
            if (currentScheduleId) {
                await renderScheduleGrid(currentScheduleId, 'aluno');
            }
            await renderAlunoTasksByDay(selectedDay);
            
            if (data.xpGanho > 0) {
                showToast(`✅ +${data.xpGanho} XP!`, 'success');
            } else {
                showToast(`✅ Status: ${newStatus}`, 'success');
            }
        }
    } catch (error) {
        console.error('❌ Erro:', error);
        showToast('❌ ' + error.message, 'error');
    } finally {
        isUpdating = false;
    }
}
