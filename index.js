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

// Helper para executar queries com timeout
const runQuery = async (query, params = {}, timeout = 30000) => {
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

    if (user.role === 'adm') {
      user.alunosVinculados = alunos.map(a => a.id);
    }

    res.json({ user });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login: ' + error.message });
  }
});

// Cadastrar aluno
app.post('/api/users/aluno', async (req, res) => {
  const { name, password, admId } = req.body;

  try {
    const alunoId = 'aluno_' + Date.now();
    
    const result = await runQuery(
      `
      MATCH (adm:User {id: $admId})
      CREATE (aluno:User {
        id: $alunoId,
        name: $name,
        password: $password,
        role: 'aluno',
        xp: 0,
        level: 1,
        achievements: []
      })
      CREATE (adm)-[:VINCULA]->(aluno)
      RETURN aluno
      `,
      { admId, alunoId, name, password }
    );

    const aluno = result.records[0].get('aluno').properties;
    res.json(aluno);
  } catch (error) {
    console.error('Erro ao cadastrar aluno:', error);
    res.status(500).json({ error: 'Erro ao cadastrar aluno: ' + error.message });
  }
});

// Remover aluno
app.delete('/api/users/aluno/:alunoId', async (req, res) => {
  const { alunoId } = req.params;
  const { admId } = req.body;

  try {
    await runQuery(
      `
      MATCH (adm:User {id: $admId})-[r:VINCULA]->(aluno:User {id: $alunoId})
      DELETE r
      WITH aluno
      OPTIONAL MATCH (aluno)-[:TEM_TAREFA]->(t:Task)
      OPTIONAL MATCH (aluno)-[:TEM_DUVIDA]->(q:Question)
      OPTIONAL MATCH (aluno)-[:TEM_LOG]->(l:Log)
      OPTIONAL MATCH (aluno)-[:TEM_HORARIO]->(s:Schedule)
      DETACH DELETE aluno, t, q, l, s
      `,
      { admId, alunoId }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover aluno:', error);
    res.status(500).json({ error: 'Erro ao remover aluno: ' + error.message });
  }
});

// Buscar alunos vinculados
app.get('/api/users/alunos/:admId', async (req, res) => {
  const { admId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (adm:User {id: $admId})-[:VINCULA]->(aluno:User)
      RETURN aluno
      ORDER BY aluno.name
      `,
      { admId }
    );

    const alunos = result.records.map(r => r.get('aluno').properties);
    res.json(alunos);
  } catch (error) {
    console.error('Erro ao buscar alunos:', error);
    res.status(500).json({ error: 'Erro ao buscar alunos: ' + error.message });
  }
});

// Buscar dados do aluno
app.get('/api/users/aluno/:alunoId', async (req, res) => {
  const { alunoId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (u:User {id: $alunoId})
      RETURN u
      `,
      { alunoId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    const aluno = result.records[0].get('u').properties;
    res.json(aluno);
  } catch (error) {
    console.error('Erro ao buscar aluno:', error);
    res.status(500).json({ error: 'Erro ao buscar aluno: ' + error.message });
  }
});

// ============ TAREFAS ============

// Criar tarefa
app.post('/api/tasks', async (req, res) => {
  const { alunoId, day, timeStart, timeEnd, name } = req.body;

  try {
    const taskId = Date.now();
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
        day: $day,
        timeStart: $timeStart,
        timeEnd: $timeEnd,
        name: $name,
        status: 'Pendente',
        justification: ''
      })
      CREATE (aluno)-[:TEM_TAREFA]->(t)
      RETURN t
      `,
      { alunoId, taskId, day, timeStart, timeEnd, name }
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
        justification: 'Tarefa criada pelo assessor',
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
      ORDER BY t.day, t.timeStart
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

// Buscar tarefas de todos os alunos de um admin
app.get('/api/tasks/admin/:admId', async (req, res) => {
  const { admId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (adm:User {id: $admId})-[:VINCULA]->(aluno:User)-[:TEM_TAREFA]->(t:Task)
      RETURN aluno, t
      ORDER BY t.day, t.timeStart
      `,
      { admId }
    );

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

// Atualizar status da tarefa
app.put('/api/tasks/:taskId/status', async (req, res) => {
  const { taskId } = req.params;
  const { status, justification, alunoId } = req.body;

  try {
    console.log(`🔄 Atualizando tarefa ID: ${taskId} para status: ${status}`);
    
    let checkResult = await runQuery(
      `MATCH (t:Task) WHERE toString(t.id) = $taskIdStr OR t.id = $taskIdNum RETURN t`,
      { 
        taskIdStr: String(taskId),
        taskIdNum: parseInt(taskId) || 0
      }
    );

    if (checkResult.records.length === 0) {
      checkResult = await runQuery(
        'MATCH (t:Task {id: $taskId}) RETURN t',
        { taskId: String(taskId) }
      );
    }

    if (checkResult.records.length === 0) {
      const numericId = parseInt(taskId);
      if (!isNaN(numericId)) {
        checkResult = await runQuery(
          'MATCH (t:Task {id: $taskId}) RETURN t',
          { taskId: numericId }
        );
      }
    }

    if (checkResult.records.length === 0) {
      console.log(`❌ Tarefa ${taskId} não encontrada`);
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }

    const task = checkResult.records[0].get('t').properties;
    const oldStatus = task.status;
    const taskName = task.name;
    const taskRealId = task.id;

    console.log(`📝 Tarefa encontrada: ${taskName} (ID: ${taskRealId})`);

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

    const alunoResult = await runQuery(
      'MATCH (u:User {id: $alunoId}) RETURN u.name',
      { alunoId }
    );
    const alunoName = alunoResult.records.length > 0 ? alunoResult.records[0].get('u.name') : 'Aluno';

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
    await runQuery(
      `
      MATCH (t:Task {id: $taskId})
      OPTIONAL MATCH (t)-[:TEM_LOG]-(l:Log)
      DETACH DELETE t, l
      `,
      { taskId: parseInt(taskId) || taskId }
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
        status: 'Nova'
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

// Buscar dúvidas de alunos vinculados a um admin
app.get('/api/questions/admin/:admId', async (req, res) => {
  const { admId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (adm:User {id: $admId})-[:VINCULA]->(aluno:User)-[:TEM_DUVIDA]->(q:Question)
      RETURN aluno, q
      ORDER BY q.id DESC
      `,
      { admId }
    );

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
          q.status = 'Respondida'
      RETURN q
      `,
      { questionId: parseInt(questionId) || questionId, answer }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao responder dúvida:', error);
    res.status(500).json({ error: 'Erro ao responder dúvida: ' + error.message });
  }
});

// ============ LOGS ============

// Buscar logs de um admin
app.get('/api/logs/admin/:admId', async (req, res) => {
  const { admId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (adm:User {id: $admId})-[:VINCULA]->(aluno:User)-[:TEM_LOG]->(l:Log)
      RETURN l
      ORDER BY l.id DESC
      LIMIT 50
      `,
      { admId }
    );

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
  const { alunoId, nome, dias } = req.body;

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

    const result = await runQuery(
      `
      MATCH (aluno:User {id: $alunoId})
      CREATE (s:Schedule {
        id: $scheduleId,
        nome: $nome,
        created_at: $timestamp,
        dias: $dias
      })
      CREATE (aluno)-[:TEM_HORARIO]->(s)
      RETURN s
      `,
      { 
        alunoId, 
        scheduleId, 
        nome, 
        timestamp,
        dias: JSON.stringify(dias || {})
      }
    );

    const schedule = result.records[0].get('s').properties;
    try {
      schedule.dias = JSON.parse(schedule.dias);
    } catch (e) {
      schedule.dias = {};
    }

    res.json(schedule);
  } catch (error) {
    console.error('Erro ao criar horário:', error);
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
        s.dias = JSON.parse(s.dias);
      } catch (e) {
        s.dias = {};
      }
      return s;
    });

    res.json(schedules);
  } catch (error) {
    console.error('Erro ao buscar horários:', error);
    res.status(500).json({ error: 'Erro ao buscar horários: ' + error.message });
  }
});

// Buscar horários de todos os alunos de um admin
app.get('/api/schedules/admin/:admId', async (req, res) => {
  const { admId } = req.params;

  try {
    const result = await runQuery(
      `
      MATCH (adm:User {id: $admId})-[:VINCULA]->(aluno:User)-[:TEM_HORARIO]->(s:Schedule)
      RETURN aluno, s
      ORDER BY s.created_at DESC
      `,
      { admId }
    );

    const schedules = result.records.map(r => {
      const s = r.get('s').properties;
      try {
        s.dias = JSON.parse(s.dias);
      } catch (e) {
        s.dias = {};
      }
      return {
        ...s,
        alunoName: r.get('aluno').properties.name,
        alunoId: r.get('aluno').properties.id
      };
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
  const { nome, dias } = req.body;

  try {
    // Verificar se o schedule existe
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
          s.dias = $dias
      RETURN s
      `,
      { scheduleId, nome, dias: JSON.stringify(dias || {}) }
    );

    const schedule = result.records[0].get('s').properties;
    try {
      schedule.dias = JSON.parse(schedule.dias);
    } catch (e) {
      schedule.dias = {};
    }

    res.json(schedule);
  } catch (error) {
    console.error('Erro ao atualizar horário:', error);
    res.status(500).json({ error: 'Erro ao atualizar horário: ' + error.message });
  }
});

// Deletar um horário
app.delete('/api/schedules/:scheduleId', async (req, res) => {
  const { scheduleId } = req.params;

  try {
    await runQuery(
      `
      MATCH (s:Schedule {id: $scheduleId})
      DETACH DELETE s
      `,
      { scheduleId }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar horário:', error);
    res.status(500).json({ error: 'Erro ao deletar horário: ' + error.message });
  }
});

// ============ DEBUG - LISTAR TODAS AS ROTAS ============
app.get('/api/routes', (req, res) => {
  const routes = [];
  
  app._router.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      routes.push(`${methods} ${layer.route.path}`);
    }
  });
  
  res.json({ routes });
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

// Inicializar banco (não bloquear o servidor)
initDatabase();

// ============ ROTA PRINCIPAL ============

// Servir o index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota de fallback para SPA
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.status(404).json({ error: 'Rota não encontrada' });
  }
});

// ============ EXPORTAR PARA VERCEL ============
module.exports = app;
