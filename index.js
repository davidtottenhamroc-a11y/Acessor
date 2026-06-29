const express = require('express');
const cors = require('cors');
const neo4j = require('neo4j-driver');
const path = require('path');

const app = express();

// Configuração do Neo4j
let driver = null;

try {
  driver = neo4j.driver(
    process.env.NEO4J_URI || 'neo4j+s://a9f5780c.databases.neo4j.io',
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME || 'neo4j',
      process.env.NEO4J_PASSWORD || 'cONVmYl84e51rI_2AsYldUfxvFPW7F_UU5LBpXyAtFQ'
    )
  );
  console.log('✅ Driver Neo4j criado com sucesso');
} catch (error) {
  console.error('❌ Erro ao criar driver Neo4j:', error.message);
}

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('.'));

// Helper para executar queries
const runQuery = async (query, params = {}) => {
  if (!driver) {
    throw new Error('Driver Neo4j não inicializado');
  }
  
  const session = driver.session();
  try {
    const result = await session.run(query, params);
    return result;
  } catch (error) {
    console.error('❌ Erro na query:', error.message);
    throw error;
  } finally {
    await session.close();
  }
};

// ============ HEALTH CHECK ============
app.get('/api/health', async (req, res) => {
  try {
    if (!driver) {
      return res.status(500).json({ 
        status: 'error', 
        message: 'Driver Neo4j não inicializado' 
      });
    }
    
    const session = driver.session();
    await session.run('RETURN 1 AS test');
    await session.close();
    
    res.json({ 
      status: 'ok', 
      message: 'Conexão com Neo4j estabelecida',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// ============ USUÁRIOS ============

// Login
app.post('/api/login', async (req, res) => {
  const { name, password, role } = req.body;

  try {
    const result = await runQuery(
      `
      MATCH (u:User {name: $name, password: $password, role: $role})
      OPTIONAL MATCH (u)-[:VINCULA]->(aluno:User)
      RETURN u, COLLECT(aluno) AS alunos
      `,
      { name, password, role }
    );

    if (result.records.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const record = result.records[0];
    const user = record.get('u').properties;
    const alunos = record.get('alunos').map(a => a.properties);

    if (user.role === 'adm' || user.role === 'assessor') {
      user.alunosVinculados = alunos.map(a => a.id);
    }

    res.json({ user });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login: ' + error.message });
  }
});

// Cadastrar aluno (adm OU assessor podem cadastrar)
app.post('/api/users/aluno', async (req, res) => {
  const { name, password, userId } = req.body;

  try {
    // Verificar se o usuário existe
    const userCheck = await runQuery(
      'MATCH (u:User {id: $userId}) RETURN u',
      { userId }
    );

    if (userCheck.records.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = userCheck.records[0].get('u').properties;
    
    // Verificar se é adm ou assessor
    if (user.role !== 'adm' && user.role !== 'assessor') {
      return res.status(403).json({ error: 'Apenas administradores e assessores podem cadastrar alunos' });
    }

    const alunoId = 'aluno_' + Date.now();
    
    const result = await runQuery(
      `
      MATCH (user:User {id: $userId})
      CREATE (aluno:User {
        id: $alunoId,
        name: $name,
        password: $password,
        role: 'aluno',
        xp: 0,
        level: 1,
        achievements: []
      })
      CREATE (user)-[:VINCULA]->(aluno)
      RETURN aluno
      `,
      { userId, alunoId, name, password }
    );

    const aluno = result.records[0].get('aluno').properties;
    res.json(aluno);
  } catch (error) {
    console.error('Erro ao cadastrar aluno:', error);
    res.status(500).json({ error: 'Erro ao cadastrar aluno: ' + error.message });
  }
});

// Cadastrar assessor (apenas adm)
app.post('/api/users/assessor', async (req, res) => {
  const { name, password, admId } = req.body;

  try {
    // Verificar se o criador é um admin
    const adminCheck = await runQuery(
      'MATCH (u:User {id: $admId, role: "adm"}) RETURN u',
      { admId }
    );

    if (adminCheck.records.length === 0) {
      return res.status(403).json({ error: 'Apenas administradores podem cadastrar assessores' });
    }

    const assessorId = 'assessor_' + Date.now();
    
    const result = await runQuery(
      `
      MATCH (adm:User {id: $admId})
      CREATE (assessor:User {
        id: $assessorId,
        name: $name,
        password: $password,
        role: 'assessor'
      })
      CREATE (adm)-[:VINCULA_ASSESSOR]->(assessor)
      RETURN assessor
      `,
      { admId, assessorId, name, password }
    );

    const assessor = result.records[0].get('assessor').properties;
    res.json(assessor);
  } catch (error) {
    console.error('Erro ao cadastrar assessor:', error);
    res.status(500).json({ error: 'Erro ao cadastrar assessor: ' + error.message });
  }
});

// Vincular aluno a um assessor (apenas adm)
app.post('/api/users/vincular', async (req, res) => {
  const { alunoId, assessorId, admId } = req.body;

  try {
    // Verificar se o adm existe
    const adminCheck = await runQuery(
      'MATCH (u:User {id: $admId, role: "adm"}) RETURN u',
      { admId }
    );

    if (adminCheck.records.length === 0) {
      return res.status(403).json({ error: 'Apenas administradores podem vincular alunos' });
    }

    // Verificar se o assessor existe
    const assessorCheck = await runQuery(
      'MATCH (u:User {id: $assessorId, role: "assessor"}) RETURN u',
      { assessorId }
    );

    if (assessorCheck.records.length === 0) {
      return res.status(404).json({ error: 'Assessor não encontrado' });
    }

    // Verificar se o aluno existe
    const alunoCheck = await runQuery(
      'MATCH (u:User {id: $alunoId, role: "aluno"}) RETURN u',
      { alunoId }
    );

    if (alunoCheck.records.length === 0) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    // Remover vínculo anterior se existir
    await runQuery(
      `
      MATCH (assessor:User)-[r:VINCULA]->(aluno:User {id: $alunoId})
      DELETE r
      `,
      { alunoId }
    );

    // Criar novo vínculo
    await runQuery(
      `
      MATCH (assessor:User {id: $assessorId})
      MATCH (aluno:User {id: $alunoId})
      CREATE (assessor)-[:VINCULA]->(aluno)
      RETURN assessor, aluno
      `,
      { assessorId, alunoId }
    );

    res.json({ success: true, message: 'Aluno vinculado ao assessor com sucesso' });
  } catch (error) {
    console.error('Erro ao vincular aluno:', error);
    res.status(500).json({ error: 'Erro ao vincular aluno: ' + error.message });
  }
});

// Remover aluno
app.delete('/api/users/aluno/:alunoId', async (req, res) => {
  const { alunoId } = req.params;
  const { userId } = req.body;

  try {
    // Verificar se o usuário existe
    const userCheck = await runQuery(
      'MATCH (u:User {id: $userId}) RETURN u',
      { userId }
    );

    if (userCheck.records.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = userCheck.records[0].get('u').properties;
    
    if (user.role !== 'adm' && user.role !== 'assessor') {
      return res.status(403).json({ error: 'Apenas administradores e assessores podem remover alunos' });
    }

    await runQuery(
      `
      MATCH (user:User {id: $userId})-[r:VINCULA]->(aluno:User {id: $alunoId})
      DELETE r
      WITH aluno
      OPTIONAL MATCH (aluno)-[:TEM_TAREFA]->(t:Task)
      OPTIONAL MATCH (aluno)-[:TEM_DUVIDA]->(q:Question)
      OPTIONAL MATCH (aluno)-[:TEM_LOG]->(l:Log)
      OPTIONAL MATCH (aluno)-[:TEM_HORARIO]->(s:Schedule)
      OPTIONAL MATCH (assessor:User)-[:VINCULA]->(aluno)
      DELETE r2
      DETACH DELETE aluno, t, q, l, s
      `,
      { userId, alunoId }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover aluno:', error);
    res.status(500).json({ error: 'Erro ao remover aluno: ' + error.message });
  }
});

// Remover assessor (apenas adm)
app.delete('/api/users/assessor/:assessorId', async (req, res) => {
  const { assessorId } = req.params;
  const { admId } = req.body;

  try {
    // Verificar se o adm tem permissão
    const adminCheck = await runQuery(
      'MATCH (u:User {id: $admId, role: "adm"}) RETURN u',
      { admId }
    );

    if (adminCheck.records.length === 0) {
      return res.status(403).json({ error: 'Apenas administradores podem remover assessores' });
    }

    // Remover vínculos e o assessor
    await runQuery(
      `
      MATCH (adm:User {id: $admId})-[:VINCULA_ASSESSOR]->(assessor:User {id: $assessorId})
      DELETE r
      WITH assessor
      OPTIONAL MATCH (assessor)-[:VINCULA]->(aluno:User)
      DELETE r2
      DETACH DELETE assessor
      `,
      { admId, assessorId }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover assessor:', error);
    res.status(500).json({ error: 'Erro ao remover assessor: ' + error.message });
  }
});

// Buscar alunos vinculados a um usuário
app.get('/api/users/alunos/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (user:User {id: $userId})-[:VINCULA]->(aluno:User)
      RETURN aluno
      ORDER BY aluno.name
      `,
      { userId }
    );

    const alunos = result.records.map(r => r.get('aluno').properties);
    res.json(alunos);
  } catch (error) {
    console.error('Erro ao buscar alunos:', error);
    res.status(500).json({ error: 'Erro ao buscar alunos: ' + error.message });
  }
});

// Buscar assessores vinculados a um adm
app.get('/api/users/assessores/:admId', async (req, res) => {
  const { admId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (adm:User {id: $admId})-[:VINCULA_ASSESSOR]->(assessor:User)
      RETURN assessor
      ORDER BY assessor.name
      `,
      { admId }
    );

    const assessores = result.records.map(r => r.get('assessor').properties);
    res.json(assessores);
  } catch (error) {
    console.error('Erro ao buscar assessores:', error);
    res.status(500).json({ error: 'Erro ao buscar assessores: ' + error.message });
  }
});

// Buscar dados do usuário
app.get('/api/users/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (u:User {id: $userId})
      RETURN u
      `,
      { userId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = result.records[0].get('u').properties;
    res.json(user);
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar usuário: ' + error.message });
  }
});

// ============ TAREFAS ============

// Criar tarefa
app.post('/api/tasks', async (req, res) => {
  const { alunoId, data, diaSemana, timeStart, timeEnd, name, scheduleId, descricao, cor } = req.body;

  try {
    const taskId = Date.now() + Math.random() * 1000;
    const timestamp = new Date().toLocaleString('pt-BR');
    
    const alunoResult = await runQuery(
      'MATCH (u:User {id: $id}) RETURN u.name',
      { id: alunoId }
    );
    const alunoName = alunoResult.records[0].get('u.name');
    
    const result = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})
      CREATE (t:Task {
        id: $taskId,
        data: $data,
        diaSemana: $diaSemana,
        timeStart: $timeStart,
        timeEnd: $timeEnd,
        name: $name,
        status: 'Pendente',
        justification: '',
        scheduleId: $scheduleId,
        descricao: $descricao,
        cor: $cor
      })
      CREATE (aluno)-[:TEM_TAREFA]->(t)
      RETURN t
      `,
      { 
        alunoId, 
        taskId, 
        data, 
        diaSemana: diaSemana || '',
        timeStart, 
        timeEnd, 
        name,
        scheduleId: scheduleId || '',
        descricao: descricao || '',
        cor: cor || 'activity-color-1'
      }
    );

    const task = result.records[0].get('t').properties;
    
    await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})
      CREATE (l:Log {
        id: $logId,
        timestamp: $timestamp,
        alunoId: $alunoId,
        taskId: $taskId,
        oldStatus: '-',
        newStatus: 'Pendente',
        justification: 'Tarefa criada',
        alunoName: $alunoName,
        taskName: $taskName
      })
      CREATE (aluno)-[:TEM_LOG]->(l)
      `,
      {
        alunoId,
        taskId,
        logId: String(Date.now() + 1),
        timestamp,
        alunoName,
        taskName: name
      }
    );

    res.json(task);
  } catch (error) {
    console.error('Erro ao criar tarefa:', error);
    res.status(500).json({ error: 'Erro ao criar tarefa: ' + error.message });
  }
});

// Buscar tarefas de um aluno
app.get('/api/tasks/aluno/:alunoId', async (req, res) => {
  const { alunoId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})-[:TEM_TAREFA]->(t:Task)
      RETURN t
      ORDER BY t.data, t.timeStart
      `,
      { alunoId }
    );

    const tasks = result.records.map(r => r.get('t').properties);
    res.json(tasks);
  } catch (error) {
    console.error('Erro ao buscar tarefas:', error);
    res.status(500).json({ error: 'Erro ao buscar tarefas: ' + error.message });
  }
});

// Buscar tarefas por período
app.get('/api/tasks/aluno/:alunoId/periodo', async (req, res) => {
  const { alunoId } = req.params;
  const { dataInicio, dataFim } = req.query;

  try {
    let query = `
      MATCH (aluno:User {id: $alunoId})-[:TEM_TAREFA]->(t:Task)
      WHERE t.data >= $dataInicio AND t.data <= $dataFim
      RETURN t
      ORDER BY t.data, t.timeStart
    `;
    
    const result = await runQuery(query, { alunoId, dataInicio, dataFim });

    const tasks = result.records.map(r => r.get('t').properties);
    res.json(tasks);
  } catch (error) {
    console.error('Erro ao buscar tarefas por período:', error);
    res.status(500).json({ error: 'Erro ao buscar tarefas por período: ' + error.message });
  }
});

// Buscar tarefas de todos os alunos de um usuário
app.get('/api/tasks/user/:userId', async (req, res) => {
  const { userId } = req.params;
  const { dataInicio, dataFim, alunoId } = req.query;

  try {
    let query = `
      MATCH (user:User {id: $userId})-[:VINCULA]->(aluno:User)-[:TEM_TAREFA]->(t:Task)
    `;
    let params = { userId };
    
    if (alunoId && alunoId !== 'all') {
      query += ` WHERE aluno.id = $alunoId`;
      params.alunoId = alunoId;
    }
    
    if (dataInicio && dataFim) {
      query += alunoId && alunoId !== 'all' ? ` AND` : ` WHERE`;
      query += ` t.data >= $dataInicio AND t.data <= $dataFim`;
      params.dataInicio = dataInicio;
      params.dataFim = dataFim;
    }
    
    query += ` RETURN aluno, t ORDER BY t.data, t.timeStart`;
    
    const result = await runQuery(query, params);

    const tasks = result.records.map(r => ({
      ...r.get('t').properties,
      alunoName: r.get('aluno').properties.name,
      alunoId: r.get('aluno').properties.id
    }));
    res.json(tasks);
  } catch (error) {
    console.error('Erro ao buscar tarefas:', error);
    res.status(500).json({ error: 'Erro ao buscar tarefas: ' + error.message });
  }
});

/// ============ ATUALIZAR STATUS DA TAREFA (VERSÃO DEFINITIVA) ============
app.put('/api/tasks/:taskId/status', async (req, res) => {
  const { taskId } = req.params;
  const { status, justification, alunoId } = req.body;

  try {
    // Limpar o ID (remover decimais)
    const taskIdClean = String(taskId).split('.')[0];
    
    console.log(`🔄 Atualizando tarefa - ID recebido: ${taskId}, ID limpo: ${taskIdClean}`);
    console.log(`📝 Status: ${status}, Aluno: ${alunoId}`);
    
    // Tentar buscar a tarefa de várias formas
    let checkResult = null;
    
    // 1. Tentar como string (toString)
    checkResult = await runQuery(
      'MATCH (t:Task) WHERE toString(t.id) = $taskIdStr RETURN t',
      { taskIdStr: taskIdClean }
    );
    
    // 2. Se não encontrou, tentar como número
    if (!checkResult || checkResult.records.length === 0) {
      const taskIdNum = Number(taskIdClean);
      if (!isNaN(taskIdNum)) {
        console.log(`🔍 Tentando buscar como número: ${taskIdNum}`);
        checkResult = await runQuery(
          'MATCH (t:Task) WHERE t.id = $taskIdNum RETURN t',
          { taskIdNum: taskIdNum }
        );
      }
    }
    
    // 3. Se ainda não encontrou, tentar buscar todos e filtrar no JavaScript
    if (!checkResult || checkResult.records.length === 0) {
      console.log(`🔍 Buscando todas as tarefas e filtrando...`);
      const allTasksResult = await runQuery('MATCH (t:Task) RETURN t');
      const allTasks = allTasksResult.records.map(r => r.get('t').properties);
      
      // Procurar pelo ID comparando como string
      const foundTask = allTasks.find(t => String(t.id) === taskIdClean);
      
      if (foundTask) {
        console.log(`✅ Tarefa encontrada via filtro: ${foundTask.name} (ID: ${foundTask.id})`);
        // Criar um resultado falso para continuar o fluxo
        checkResult = { records: [{ get: () => ({ properties: foundTask }) }] };
      }
    }

    if (!checkResult || checkResult.records.length === 0) {
      console.log(`❌ Tarefa ${taskId} não encontrada após todas as tentativas`);
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }

    // Extrair a tarefa do resultado
    let task;
    if (checkResult.records[0].get('t')) {
      task = checkResult.records[0].get('t').properties;
    } else if (checkResult.records[0].properties) {
      task = checkResult.records[0].properties;
    } else {
      task = checkResult.records[0];
    }

    const oldStatus = task.status;
    const taskName = task.name;
    const taskRealId = task.id;

    console.log(`📝 Tarefa encontrada: ${taskName} (ID: ${taskRealId}, tipo: ${typeof taskRealId})`);
    console.log(`📝 Status antigo: ${oldStatus} → Novo: ${status}`);

    // Atualizar o status - usar o ID real da tarefa
    await runQuery(
      `
      MATCH (t:Task {id: $taskId})
      SET t.status = $status,
          t.justification = $justification
      RETURN t
      `,
      { 
        taskId: taskRealId, 
        status, 
        justification: justification || '' 
      }
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
      if (oldStatus === 'Não Feito') {
        xpGanho = 25;
      } else {
        xpGanho = 15;
      }
    } else if (status === 'Em Andamento' && oldStatus === 'Pendente') {
      xpGanho = 5;
    } else if (status === 'Não Feito' && oldStatus !== 'Não Feito') {
      xpGanho = 2;
    }

    if (xpGanho > 0) {
      await runQuery(
        `
        MATCH (u:User {id: $alunoId})
        SET u.xp = (u.xp + $xpGanho)
        SET u.level = (toInteger(u.xp / 100) + 1)
        RETURN u
        `,
        { alunoId, xpGanho }
      );
      console.log(`✅ +${xpGanho} XP para o aluno`);
    }

    // Buscar a tarefa atualizada
    const updatedResult = await runQuery(
      'MATCH (t:Task {id: $taskId}) RETURN t',
      { taskId: taskRealId }
    );
    const updatedTask = updatedResult.records[0].get('t').properties;

    res.json({ 
      success: true, 
      task: updatedTask,
      xpGanho,
      message: `Status atualizado para ${status}`
    });

  } catch (error) {
    console.error('❌ Erro ao atualizar tarefa:', error);
    res.status(500).json({ error: 'Erro ao atualizar status da tarefa: ' + error.message });
  }
});
// Deletar tarefa
app.delete('/api/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;

  try {
    const taskIdClean = String(taskId).split('.')[0];
    const taskIdNum = Number(taskIdClean);
    
    console.log(`🗑️ Deletando tarefa com ID: ${taskIdNum}`);
    
    await runQuery(
      `
      MATCH (t:Task {id: $taskId})
      OPTIONAL MATCH (t)-[:TEM_LOG]-(l:Log)
      DETACH DELETE t, l
      `,
      { taskId: taskIdNum }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar tarefa:', error);
    res.status(500).json({ error: 'Erro ao deletar tarefa: ' + error.message });
  }
});

// ============ DÚVIDAS ============

// Enviar dúvida
app.post('/api/questions', async (req, res) => {
  const { alunoId, text } = req.body;

  try {
    const questionId = Date.now();
    
    const result = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})
      CREATE (q:Question {
        id: $questionId,
        text: $text,
        answer: '',
        status: 'Nova',
        created_at: datetime()
      })
      CREATE (aluno)-[:TEM_DUVIDA]->(q)
      RETURN q
      `,
      { alunoId, questionId, text }
    );

    const question = result.records[0].get('q').properties;
    
    await runQuery(
      `
      MATCH (u:User {id: $alunoId})
      SET u.xp = (u.xp + 10)
      SET u.level = (toInteger(u.xp / 100) + 1)
      RETURN u
      `,
      { alunoId }
    );

    res.json(question);
  } catch (error) {
    console.error('Erro ao enviar dúvida:', error);
    res.status(500).json({ error: 'Erro ao enviar dúvida: ' + error.message });
  }
});

// Buscar dúvidas de um aluno
app.get('/api/questions/aluno/:alunoId', async (req, res) => {
  const { alunoId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})-[:TEM_DUVIDA]->(q:Question)
      RETURN q
      ORDER BY q.id DESC
      `,
      { alunoId }
    );

    const questions = result.records.map(r => r.get('q').properties);
    res.json(questions);
  } catch (error) {
    console.error('Erro ao buscar dúvidas:', error);
    res.status(500).json({ error: 'Erro ao buscar dúvidas: ' + error.message });
  }
});

// Buscar dúvidas de alunos vinculados a um usuário
app.get('/api/questions/user/:userId', async (req, res) => {
  const { userId } = req.params;
  const { status } = req.query;

  try {
    let query = `
      MATCH (user:User {id: $userId})-[:VINCULA]->(aluno:User)-[:TEM_DUVIDA]->(q:Question)
    `;
    let params = { userId };
    
    if (status && status !== 'all') {
      query += ` WHERE q.status = $status`;
      params.status = status;
    }
    
    query += ` RETURN aluno, q ORDER BY q.id DESC`;
    
    const result = await runQuery(query, params);

    const questions = result.records.map(r => ({
      ...r.get('q').properties,
      alunoName: r.get('aluno').properties.name,
      alunoId: r.get('aluno').properties.id
    }));
    res.json(questions);
  } catch (error) {
    console.error('Erro ao buscar dúvidas:', error);
    res.status(500).json({ error: 'Erro ao buscar dúvidas: ' + error.message });
  }
});

// Responder dúvida
app.put('/api/questions/:questionId/answer', async (req, res) => {
  const { questionId } = req.params;
  const { answer } = req.body;

  try {
    await runQuery(
      `
      MATCH (q:Question {id: $questionId})
      SET q.answer = $answer,
          q.status = 'Respondida',
          q.respondida_em = datetime()
      RETURN q
      `,
      { questionId: Number(questionId) || questionId, answer }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao responder dúvida:', error);
    res.status(500).json({ error: 'Erro ao responder dúvida: ' + error.message });
  }
});

// ============ LOGS ============

// Buscar logs de um usuário
app.get('/api/logs/user/:userId', async (req, res) => {
  const { userId } = req.params;
  const { alunoId, dataInicio, dataFim } = req.query;

  try {
    let query = `
      MATCH (user:User {id: $userId})-[:VINCULA]->(aluno:User)-[:TEM_LOG]->(l:Log)
    `;
    let params = { userId };
    
    if (alunoId && alunoId !== 'all') {
      query += ` WHERE l.alunoId = $alunoId`;
      params.alunoId = alunoId;
    }
    
    if (dataInicio && dataFim) {
      query += alunoId && alunoId !== 'all' ? ` AND` : ` WHERE`;
      query += ` l.timestamp >= $dataInicio AND l.timestamp <= $dataFim`;
      params.dataInicio = dataInicio;
      params.dataFim = dataFim;
    }
    
    query += ` RETURN l ORDER BY l.id DESC LIMIT 100`;
    
    const result = await runQuery(query, params);

    const logs = result.records.map(r => r.get('l').properties);
    res.json(logs);
  } catch (error) {
    console.error('Erro ao buscar logs:', error);
    res.status(500).json({ error: 'Erro ao buscar logs: ' + error.message });
  }
});

// ============ ACHIEVEMENTS ============

// Atualizar conquistas
app.post('/api/achievements/check', async (req, res) => {
  const { alunoId } = req.body;

  try {
    const result = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})
      OPTIONAL MATCH (aluno)-[:TEM_TAREFA]->(t:Task)
      OPTIONAL MATCH (aluno)-[:TEM_DUVIDA]->(q:Question)
      OPTIONAL MATCH (aluno)-[:TEM_LOG]->(l:Log)
      RETURN aluno,
             COUNT(DISTINCT t) AS totalTasks,
             COUNT(DISTINCT CASE WHEN t.status = 'Realizado' THEN t END) AS doneTasks,
             COUNT(DISTINCT q) AS totalQuestions,
             COUNT(DISTINCT CASE WHEN l.oldStatus = 'Não Feito' AND l.newStatus = 'Realizado' THEN l END) AS recoveredTasks
      `,
      { alunoId }
    );

    const record = result.records[0];
    const aluno = record.get('aluno').properties;
    const doneTasks = record.get('doneTasks').toInt();
    const totalQuestions = record.get('totalQuestions').toInt();
    const recoveredTasks = record.get('recoveredTasks').toInt();
    
    const achievs = aluno.achievements || [];
    let changed = false;
    
    if (doneTasks >= 5 && !achievs.includes('ach1')) {
      achievs.push('ach1');
      changed = true;
    }
    if (totalQuestions >= 3 && !achievs.includes('ach2')) {
      achievs.push('ach2');
      changed = true;
    }
    if (recoveredTasks >= 1 && !achievs.includes('ach3')) {
      achievs.push('ach3');
      changed = true;
    }
    
    if (changed) {
      await runQuery(
        `
        MATCH (u:User {id: $alunoId})
        SET u.achievements = $achievs
        RETURN u
        `,
        { alunoId, achievs }
      );
    }
    
    res.json({ 
      achievements: achievs, 
      changed 
    });
  } catch (error) {
    console.error('Erro ao verificar conquistas:', error);
    res.status(500).json({ error: 'Erro ao verificar conquistas: ' + error.message });
  }
});

// ============ HORÁRIOS (SCHEDULES) ============

// Criar um quadro de horários para um aluno
app.post('/api/schedules', async (req, res) => {
  const { alunoId, nome, dataInicio, dataFim, diasSemana, atividades } = req.body;

  console.log('📝 Recebendo criação de horário:');
  console.log('  - alunoId:', alunoId);
  console.log('  - nome:', nome);
  console.log('  - dataInicio:', dataInicio);
  console.log('  - dataFim:', dataFim);
  console.log('  - diasSemana:', diasSemana);

  try {
    const scheduleId = 'schedule_' + Date.now();
    const timestamp = new Date().toLocaleString('pt-BR');

    // Verificar se o aluno existe
    const alunoCheck = await runQuery(
      'MATCH (aluno:User {id: $alunoId}) RETURN aluno',
      { alunoId }
    );

    if (alunoCheck.records.length === 0) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    const alunoName = alunoCheck.records[0].get('aluno').properties.name;

    // Criar o schedule
    const result = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})
      CREATE (s:Schedule {
        id: $scheduleId,
        nome: $nome,
        created_at: $timestamp,
        dataInicio: $dataInicio,
        dataFim: $dataFim,
        diasSemana: $diasSemana,
        atividades: $atividades
      })
      CREATE (aluno)-[:TEM_HORARIO]->(s)
      RETURN s
      `,
      { 
        alunoId, 
        scheduleId, 
        nome, 
        timestamp,
        dataInicio: dataInicio || '',
        dataFim: dataFim || '',
        diasSemana: JSON.stringify(diasSemana || []),
        atividades: JSON.stringify(atividades || {})
      }
    );

    const schedule = result.records[0].get('s').properties;
    try {
      schedule.diasSemana = JSON.parse(schedule.diasSemana);
      schedule.atividades = JSON.parse(schedule.atividades);
    } catch (e) {
      schedule.diasSemana = [];
      schedule.atividades = {};
    }

    // ====== CRIAR TAREFAS AUTOMATICAMENTE ======
    const tarefasCriadas = [];

    if (dataInicio && dataFim && atividades) {
      console.log('🔄 Gerando tarefas para o período...');
      
      const startDate = new Date(dataInicio);
      const endDate = new Date(dataFim);
      
      const dayNames = {
        0: 'domingo',
        1: 'segunda',
        2: 'terca',
        3: 'quarta',
        4: 'quinta',
        5: 'sexta',
        6: 'sabado'
      };

      const diasSelecionados = schedule.diasSemana || [];
      const todosDiasLiberados = diasSelecionados.length === 0;

      let totalTarefas = 0;
      const currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        const dateStr = currentDate.toISOString().split('T')[0];
        const diaSemanaNome = dayNames[dayOfWeek];
        
        const diaLiberado = todosDiasLiberados || diasSelecionados.includes(diaSemanaNome);
        
        if (diaLiberado && atividades[diaSemanaNome]) {
          console.log(`  📅 Gerando tarefas para ${dateStr} (${diaSemanaNome})`);
          
          for (const [hora, atividade] of Object.entries(atividades[diaSemanaNome])) {
            if (!atividade || !atividade.nome) continue;
            
            try {
              const horaParts = hora.split(':');
              const horaInicio = parseInt(horaParts[0]);
              const horaFim = horaInicio + 1;
              const timeEnd = `${String(horaFim).padStart(2, '0')}:${horaParts[1] || '00'}`;
              
              const taskId = Date.now() + Math.random() * 1000;
              const taskName = atividade.materia ? `${atividade.nome} - ${atividade.materia}` : atividade.nome;
              
              const taskResult = await runQuery(
                `
                MATCH (aluno:User {id: $alunoId})
                CREATE (t:Task {
                  id: $taskId,
                  data: $data,
                  diaSemana: $diaSemana,
                  timeStart: $timeStart,
                  timeEnd: $timeEnd,
                  name: $name,
                  status: 'Pendente',
                  justification: '',
                  scheduleId: $scheduleId,
                  descricao: $descricao,
                  cor: $cor
                })
                CREATE (aluno)-[:TEM_TAREFA]->(t)
                RETURN t
                `,
                {
                  alunoId,
                  taskId,
                  data: dateStr,
                  diaSemana: diaSemanaNome,
                  timeStart: hora,
                  timeEnd: timeEnd,
                  name: taskName,
                  scheduleId: scheduleId,
                  descricao: atividade.descricao || '',
                  cor: atividade.cor || 'activity-color-1'
                }
              );
              
              const task = taskResult.records[0].get('t').properties;
              tarefasCriadas.push(task);
              totalTarefas++;
              
              // Criar log
              await runQuery(
                `
                MATCH (aluno:User {id: $alunoId})
                CREATE (l:Log {
                  id: $logId,
                  timestamp: $timestamp,
                  alunoId: $alunoId,
                  taskId: $taskId,
                  oldStatus: '-',
                  newStatus: 'Pendente',
                  justification: 'Tarefa criada automaticamente pelo horário: ${nome}',
                  alunoName: $alunoName,
                  taskName: $taskName
                })
                CREATE (aluno)-[:TEM_LOG]->(l)
                `,
                {
                  alunoId,
                  taskId,
                  logId: String(Date.now() + Math.random() * 1000),
                  timestamp,
                  alunoName,
                  taskName
                }
              );
              
            } catch (error) {
              console.error(`    ❌ Erro ao criar tarefa para ${dateStr} ${hora}:`, error.message);
            }
          }
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      console.log(`✅ ${totalTarefas} tarefas criadas com sucesso!`);
    }

    res.json({ 
      schedule: schedule,
      tarefasCriadas: tarefasCriadas,
      totalTarefas: tarefasCriadas.length,
      message: `Horário criado com ${tarefasCriadas.length} tarefas geradas automaticamente!`
    });
  } catch (error) {
    console.error('❌ Erro ao criar horário:', error);
    res.status(500).json({ error: 'Erro ao criar horário: ' + error.message });
  }
});

// Buscar horários de um aluno
app.get('/api/schedules/aluno/:alunoId', async (req, res) => {
  const { alunoId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})-[:TEM_HORARIO]->(s:Schedule)
      RETURN s
      ORDER BY s.created_at DESC
      `,
      { alunoId }
    );

    const schedules = result.records.map(r => {
      const s = r.get('s').properties;
      try {
        s.diasSemana = JSON.parse(s.diasSemana);
        s.atividades = JSON.parse(s.atividades);
      } catch (e) {
        s.diasSemana = [];
        s.atividades = {};
      }
      return s;
    });

    res.json(schedules);
  } catch (error) {
    console.error('Erro ao buscar horários:', error);
    res.status(500).json({ error: 'Erro ao buscar horários: ' + error.message });
  }
});

// Atualizar um horário
app.put('/api/schedules/:scheduleId', async (req, res) => {
  const { scheduleId } = req.params;
  const { nome, dataInicio, dataFim, diasSemana, atividades } = req.body;

  try {
    const checkResult = await runQuery(
      'MATCH (s:Schedule {id: $scheduleId}) RETURN s',
      { scheduleId }
    );

    if (checkResult.records.length === 0) {
      return res.status(404).json({ error: 'Horário não encontrado' });
    }

    const result = await runQuery(
      `
      MATCH (s:Schedule {id: $scheduleId})
      SET s.nome = $nome,
          s.dataInicio = $dataInicio,
          s.dataFim = $dataFim,
          s.diasSemana = $diasSemana,
          s.atividades = $atividades
      RETURN s
      `,
      { 
        scheduleId, 
        nome, 
        dataInicio: dataInicio || '',
        dataFim: dataFim || '',
        diasSemana: JSON.stringify(diasSemana || []),
        atividades: JSON.stringify(atividades || {})
      }
    );

    const schedule = result.records[0].get('s').properties;
    try {
      schedule.diasSemana = JSON.parse(schedule.diasSemana);
      schedule.atividades = JSON.parse(schedule.atividades);
    } catch (e) {
      schedule.diasSemana = [];
      schedule.atividades = {};
    }

    res.json(schedule);
  } catch (error) {
    console.error('Erro ao atualizar horário:', error);
    res.status(500).json({ error: 'Erro ao atualizar horário: ' + error.message });
  }
});

// Deletar um horário e suas tarefas
app.delete('/api/schedules/:scheduleId', async (req, res) => {
  const { scheduleId } = req.params;

  try {
    await runQuery(
      `
      MATCH (s:Schedule {id: $scheduleId})
      OPTIONAL MATCH (t:Task {scheduleId: $scheduleId})
      DETACH DELETE s, t
      `,
      { scheduleId }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar horário:', error);
    res.status(500).json({ error: 'Erro ao deletar horário: ' + error.message });
  }
});

// ============ RELATÓRIOS ============

// Gerar relatório de atividades do aluno
app.get('/api/reports/aluno/:alunoId', async (req, res) => {
  const { alunoId } = req.params;
  const { dataInicio, dataFim } = req.query;

  try {
    // Buscar dados do aluno
    const alunoResult = await runQuery(
      'MATCH (u:User {id: $alunoId}) RETURN u',
      { alunoId }
    );

    if (alunoResult.records.length === 0) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    const aluno = alunoResult.records[0].get('u').properties;

    // Buscar tarefas do aluno no período
    let tasksQuery = `
      MATCH (aluno:User {id: $alunoId})-[:TEM_TAREFA]->(t:Task)
    `;
    let params = { alunoId };
    
    if (dataInicio && dataFim) {
      tasksQuery += ` WHERE t.data >= $dataInicio AND t.data <= $dataFim`;
      params.dataInicio = dataInicio;
      params.dataFim = dataFim;
    }
    
    tasksQuery += ` RETURN t ORDER BY t.data, t.timeStart`;
    
    const tasksResult = await runQuery(tasksQuery, params);
    const tasks = tasksResult.records.map(r => r.get('t').properties);

    // Buscar dúvidas do aluno
    const questionsResult = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})-[:TEM_DUVIDA]->(q:Question)
      RETURN q
      ORDER BY q.id DESC
      `,
      { alunoId }
    );
    const questions = questionsResult.records.map(r => r.get('q').properties);

    // Buscar logs do aluno
    const logsResult = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})-[:TEM_LOG]->(l:Log)
      RETURN l
      ORDER BY l.id DESC
      LIMIT 50
      `,
      { alunoId }
    );
    const logs = logsResult.records.map(r => r.get('l').properties);

    // Calcular estatísticas
    const totalTasks = tasks.length;
    const tasksDone = tasks.filter(t => t.status === 'Realizado').length;
    const tasksPending = tasks.filter(t => t.status === 'Pendente').length;
    const tasksNotDone = tasks.filter(t => t.status === 'Não Feito').length;
    const tasksDoing = tasks.filter(t => t.status === 'Em Andamento').length;
    
    const totalQuestions = questions.length;
    const questionsAnswered = questions.filter(q => q.status === 'Respondida').length;
    const questionsPending = questions.filter(q => q.status === 'Nova').length;

    const report = {
      aluno: {
        id: aluno.id,
        name: aluno.name,
        xp: aluno.xp || 0,
        level: aluno.level || 1,
        achievements: aluno.achievements || []
      },
      periodo: {
        dataInicio: dataInicio || 'Todas',
        dataFim: dataFim || 'Todas'
      },
      estatisticas: {
        totalTarefas: totalTasks,
        tarefasRealizadas: tasksDone,
        tarefasPendentes: tasksPending,
        tarefasNaoFeitas: tasksNotDone,
        tarefasEmAndamento: tasksDoing,
        taxaConclusao: totalTasks > 0 ? Math.round((tasksDone / totalTasks) * 100) : 0,
        totalDuvidas: totalQuestions,
        duvidasRespondidas: questionsAnswered,
        duvidasPendentes: questionsPending
      },
      tarefas: tasks,
      duvidas: questions,
      logs: logs
    };

    res.json(report);
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório: ' + error.message });
  }
});

// ============ INICIALIZAÇÃO DO BANCO ============

let dbInitialized = false;

async function initDatabase() {
  if (dbInitialized) return;
  
  try {
    if (!driver) {
      console.error('❌ Driver não disponível para inicialização');
      return;
    }

    console.log('🔄 Inicializando banco de dados...');
    
    const session = driver.session();
    try {
      // Criar constraints
      await session.run(`
        CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE
      `);
      await session.run(`
        CREATE CONSTRAINT task_id_unique IF NOT EXISTS FOR (t:Task) REQUIRE t.id IS UNIQUE
      `);
      await session.run(`
        CREATE CONSTRAINT question_id_unique IF NOT EXISTS FOR (q:Question) REQUIRE q.id IS UNIQUE
      `);
      await session.run(`
        CREATE CONSTRAINT log_id_unique IF NOT EXISTS FOR (l:Log) REQUIRE l.id IS UNIQUE
      `);
      await session.run(`
        CREATE CONSTRAINT schedule_id_unique IF NOT EXISTS FOR (s:Schedule) REQUIRE s.id IS UNIQUE
      `);

      // Verificar se há usuários
      const result = await session.run('MATCH (u:User) RETURN COUNT(u) AS count');
      const count = result.records[0].get('count').toInt();
      
      if (count === 0) {
        console.log('🔄 Criando usuários padrão...');
        await session.run(`
          CREATE (adm:User {id: 'adm_david', name: 'David', password: 'david0724', role: 'adm'})
          CREATE (aluno:User {id: 'aluno_malu', name: 'Malu', password: 'Malu123', role: 'aluno', xp: 0, level: 1, achievements: []})
          CREATE (adm)-[:VINCULA]->(aluno)
        `);
        console.log('✅ Usuários padrão criados!');
      } else {
        console.log(`✅ Banco já possui ${count} usuários`);
      }
      
      dbInitialized = true;
    } finally {
      await session.close();
    }
  } catch (error) {
    console.error('❌ Erro ao inicializar banco:', error.message);
  }
}

// Inicializar banco
initDatabase();

// ============ ROTA PRINCIPAL ============

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.status(404).json({ error: 'Rota não encontrada' });
  }
});

// ============ EXPORTAR PARA VERCEL ============
module.exports = app;
