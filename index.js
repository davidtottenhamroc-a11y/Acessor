// ============ ATUALIZAR STATUS DA TAREFA (VERSÃO CORRIGIDA) ============
app.put('/api/tasks/:taskId/status', async (req, res) => {
  const { taskId } = req.params;
  const { status, justification, alunoId } = req.body;

  try {
    console.log(`🔄 Atualizando tarefa - ID recebido: ${taskId}`);
    console.log(`📝 Status: ${status}, Aluno: ${alunoId}`);
    
    // Remover decimais e converter para número inteiro
    const taskIdStr = String(taskId).split('.')[0];
    const taskIdNum = parseInt(taskIdStr);
    
    console.log(`📝 ID limpo: ${taskIdStr} -> ${taskIdNum}`);
    
    // Buscar a tarefa usando toString() para comparar
    let result = await runQuery(
      'MATCH (t:Task) WHERE toString(t.id) = $idStr OR t.id = $idNum RETURN t',
      { idStr: taskIdStr, idNum: taskIdNum }
    );

    // Se não encontrou, tentar buscar todas e filtrar
    if (result.records.length === 0) {
      console.log(`🔍 Buscando todas as tarefas para filtrar...`);
      const allResult = await runQuery('MATCH (t:Task) RETURN t');
      const allTasks = allResult.records.map(r => r.get('t').properties);
      
      // Procurar pelo ID comparando como string
      const foundTask = allTasks.find(t => String(t.id).includes(taskIdStr));
      
      if (foundTask) {
        console.log(`✅ Tarefa encontrada via filtro: ${foundTask.name} (ID: ${foundTask.id})`);
        // Criar um resultado falso
        result = { records: [{ get: () => ({ properties: foundTask }) }] };
      }
    }

    if (result.records.length === 0) {
      console.log(`❌ Tarefa não encontrada`);
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }

    // Extrair a tarefa
    let task;
    if (result.records[0].get('t')) {
      task = result.records[0].get('t').properties;
    } else if (result.records[0].properties) {
      task = result.records[0].properties;
    } else {
      task = result.records[0];
    }

    const oldStatus = task.status;
    const taskName = task.name;
    const taskRealId = task.id;

    console.log(`📝 Tarefa: ${taskName}, ID real: ${taskRealId}, Status antigo: ${oldStatus}`);

    // Atualizar a tarefa
    await runQuery(
      `
      MATCH (t:Task {id: $id})
      SET t.status = $status, t.justification = $justification
      RETURN t
      `,
      { id: taskRealId, status, justification: justification || '' }
    );

    // Buscar nome do aluno
    const alunoResult = await runQuery(
      'MATCH (u:User {id: $alunoId}) RETURN u.name',
      { alunoId }
    );
    const alunoName = alunoResult.records.length > 0 ? alunoResult.records[0].get('u.name') : 'Aluno';

    // Criar log
    const timestamp = new Date().toLocaleString('pt-BR');
    await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})
      CREATE (l:Log {
        id: $logId,
        timestamp: $timestamp,
        alunoId: $alunoId,
        taskId: $taskId,
        oldStatus: $oldStatus,
        newStatus: $status,
        justification: $justification,
        alunoName: $alunoName,
        taskName: $taskName
      })
      CREATE (aluno)-[:TEM_LOG]->(l)
      `,
      {
        alunoId,
        taskId: taskRealId,
        logId: String(Date.now() + 1),
        timestamp,
        oldStatus,
        status,
        justification: justification || '',
        alunoName,
        taskName
      }
    );

    // Calcular XP
    let xpGanho = 0;
    if (status === 'Realizado' && oldStatus !== 'Realizado') {
      xpGanho = oldStatus === 'Não Feito' ? 25 : 15;
    } else if (status === 'Em Andamento' && oldStatus === 'Pendente') {
      xpGanho = 5;
    } else if (status === 'Não Feito' && oldStatus !== 'Não Feito') {
      xpGanho = 2;
    }

    if (xpGanho > 0) {
      await runQuery(
        `
        MATCH (u:User {id: $alunoId})
        SET u.xp = (u.xp + $xpGanho),
            u.level = (toInteger(u.xp / 100) + 1)
        RETURN u
        `,
        { alunoId, xpGanho }
      );
      console.log(`✅ +${xpGanho} XP para o aluno`);
    }

    console.log(`✅ Tarefa atualizada com sucesso!`);

    res.json({ 
      success: true, 
      xpGanho,
      message: `Status atualizado para ${status}`
    });

  } catch (error) {
    console.error('❌ Erro ao atualizar tarefa:', error);
    res.status(500).json({ error: 'Erro ao atualizar status: ' + error.message });
  }
});
