const express = require('express');
const cors = require('cors');
const neo4j = require('neo4j-driver');
const path = require('path');

const app = express();

// Configuração do Neo4j
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'neo4j+s://a9f5780c.databases.neo4j.io',
  neo4j.auth.basic(
    process.env.NEO4J_USERNAME || 'neo4j',
    process.env.NEO4J_PASSWORD || 'cONVmYl84e51rI_2AsYldUfxvFPW7F_UU5LBpXyAtFQ'
  )
);

// Middleware
app.use(cors());
app.use(express.json());

// Helper para executar queries
const runQuery = async (query, params = {}) => {
  const session = driver.session();
  try {
    const result = await session.run(query, params);
    return result;
  } finally {
    await session.close();
  }
};

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
    res.status(500).json({ error: 'Erro ao fazer login' });
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
    res.status(500).json({ error: 'Erro ao cadastrar aluno' });
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
      DETACH DELETE aluno, t, q, l
      `,
      { admId, alunoId }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover aluno:', error);
    res.status(500).json({ error: 'Erro ao remover aluno' });
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
    res.status(500).json({ error: 'Erro ao buscar alunos' });
  }
});

// ============ TAREFAS ============
// Criar tarefa
app.post('/api/tasks', async (req, res) => {
  const { alunoId, day, timeStart, timeEnd, name, admId } = req.body;

  try {
    const taskId = Date.now();
    const timestamp = new Date().toLocaleString('pt-BR');
    
    // Buscar nome do aluno
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
        justification: 'Tarefa criada pelo assessor',
        alunoName: $alunoName,
        taskName: $taskName
      })
      CREATE (aluno)-[:TEM_LOG]->(l)
      `,
      {
        alunoId,
        taskId,
        logId: Date.now() + 1,
        timestamp,
        alunoName,
        taskName: name
      }
    );

    res.json(task);
  } catch (error) {
    console.error('Erro ao criar tarefa:', error);
    res.status(500).json({ error: 'Erro ao criar tarefa' });
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
    res.status(500).json({ error: 'Erro ao buscar tarefas' });
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
    res.status(500).json({ error: 'Erro ao buscar tarefas' });
  }
});

// Atualizar status da tarefa
app.put('/api/tasks/:taskId/status', async (req, res) => {
  const { taskId } = req.params;
  const { status, justification, alunoId } = req.body;

  try {
    // Buscar status antigo
    const oldResult = await runQuery(
      'MATCH (t:Task {id: $taskId}) RETURN t.status AS oldStatus, t.name AS taskName',
      { taskId }
    );
    
    if (oldResult.records.length === 0) {
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }
    
    const oldStatus = oldResult.records[0].get('oldStatus');
    const taskName = oldResult.records[0].get('taskName');
    
    // Atualizar status
    await runQuery(
      `
      MATCH (t:Task {id: $taskId})
      SET t.status = $status,
          t.justification = $justification
      RETURN t
      `,
      { taskId, status, justification: justification || '' }
    );
    
    // Criar log
    const timestamp = new Date().toLocaleString('pt-BR');
    const alunoResult = await runQuery(
      'MATCH (u:User {id: $id}) RETURN u.name',
      { id: alunoId }
    );
    const alunoName = alunoResult.records[0].get('u.name');
    
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
        taskId,
        logId: Date.now() + 1,
        timestamp,
        oldStatus,
        status,
        justification: justification || '',
        alunoName,
        taskName
      }
    );
    
    // Atualizar XP do aluno
    if (status === 'Realizado' && oldStatus !== 'Realizado') {
      await runQuery(
        `
        MATCH (u:User {id: $alunoId})
        SET u.xp = (u.xp + 15)
        SET u.level = (toInteger(u.xp / 100) + 1)
        RETURN u
        `,
        { alunoId }
      );
    } else if (status === 'Em Andamento' && oldStatus === 'Pendente') {
      await runQuery(
        `
        MATCH (u:User {id: $alunoId})
        SET u.xp = (u.xp + 5)
        SET u.level = (toInteger(u.xp / 100) + 1)
        RETURN u
        `,
        { alunoId }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao atualizar tarefa:', error);
    res.status(500).json({ error: 'Erro ao atualizar tarefa' });
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
      { taskId }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar tarefa:', error);
    res.status(500).json({ error: 'Erro ao deletar tarefa' });
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
    
    // Adicionar XP
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
    res.status(500).json({ error: 'Erro ao enviar dúvida' });
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
    res.status(500).json({ error: 'Erro ao buscar dúvidas' });
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
    res.status(500).json({ error: 'Erro ao buscar dúvidas' });
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
      { questionId, answer }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao responder dúvida:', error);
    res.status(500).json({ error: 'Erro ao responder dúvida' });
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
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

// ============ ACHIEVEMENTS ============
// Atualizar conquistas
app.post('/api/achievements/check', async (req, res) => {
  const { alunoId } = req.body;

  try {
    // Buscar dados do aluno
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
    
    res.json({ achievements: achievs, changed });
  } catch (error) {
    console.error('Erro ao verificar conquistas:', error);
    res.status(500).json({ error: 'Erro ao verificar conquistas' });
  }
});

// ============ INICIALIZAÇÃO DO BANCO ============
async function initDatabase() {
  try {
    // Criar constraints
    await runQuery(`
      CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE
    `);
    await runQuery(`
      CREATE CONSTRAINT task_id_unique IF NOT EXISTS FOR (t:Task) REQUIRE t.id IS UNIQUE
    `);
    await runQuery(`
      CREATE CONSTRAINT question_id_unique IF NOT EXISTS FOR (q:Question) REQUIRE q.id IS UNIQUE
    `);
    await runQuery(`
      CREATE CONSTRAINT log_id_unique IF NOT EXISTS FOR (l:Log) REQUIRE l.id IS UNIQUE
    `);

    // Verificar se há usuários
    const result = await runQuery('MATCH (u:User) RETURN COUNT(u) AS count');
    const count = result.records[0].get('count').toInt();
    
    if (count === 0) {
      console.log('Criando usuários padrão...');
      await runQuery(`
        CREATE (adm:User {id: 'adm_david', name: 'David', password: 'david0724', role: 'adm'})
        CREATE (aluno:User {id: 'aluno_malu', name: 'Malu', password: '300504', role: 'aluno', xp: 0, level: 1, achievements: []})
        CREATE (adm)-[:VINCULA]->(aluno)
      `);
      console.log('Usuários padrão criados!');
    }
  } catch (error) {
    console.error('Erro ao inicializar banco:', error);
  }
}

// Inicializar banco
initDatabase();

// Rota principal para servir o frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Exportar para Vercel
module.exports = app;