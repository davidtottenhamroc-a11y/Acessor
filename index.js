async function updateTaskFromSchedule(taskId, newStatus) {
    if (isUpdating) return;
    
    try {
        isUpdating = true;
        const taskIdStr = String(taskId).split('.')[0];
        
        showToast('⏳ Atualizando...', 'info');
        
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
            throw new Error(error.error || 'Erro ao atualizar');
        }
        
        const data = await response.json();
        
        if (data.success) {
            await loadAlunoData();
            updateAlunoXP();
            await checkAchievements();
            
            if (currentScheduleId) {
                await renderScheduleGrid(currentScheduleId, 'aluno');
            }
            
            showToast(`✅ ${data.xpGanho > 0 ? '+' + data.xpGanho + ' XP! 🎉' : 'Status atualizado!'}`, 'success');
        }
    } catch (error) {
        showToast('❌ ' + error.message, 'error');
    } finally {
        isUpdating = false;
    }
}
