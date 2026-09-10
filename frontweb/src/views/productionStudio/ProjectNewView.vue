<template>
  <div class="page">
    <h1>新建项目</h1>
    <el-form class="form" label-width="90px">
      <el-form-item label="项目名称" required>
        <el-input v-model="title" maxlength="40" placeholder="给项目起个名字" />
      </el-form-item>
      <el-form-item label="画幅">
        <el-select v-model="aspectRatio">
          <el-option label="16:9 横屏" value="16:9" />
          <el-option label="9:16 竖屏" value="9:16" />
          <el-option label="1:1 方形" value="1:1" />
        </el-select>
      </el-form-item>
      <el-form-item label="题材">
        <el-input v-model="genre" maxlength="20" placeholder="如：悬疑、都市、古风" />
      </el-form-item>
      <el-form-item label="简介">
        <el-input v-model="description" type="textarea" :rows="3" placeholder="一句话介绍这个故事（可留空）" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :disabled="!title.trim()" :loading="creating" @click="create">创建项目</el-button>
        <el-button @click="$router.back()">取消</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'ProjectNewView',
  data() {
    return { title: '', aspectRatio: '16:9', genre: '', description: '', creating: false }
  },
  methods: {
    async create() {
      if (this.creating) return
      this.creating = true
      try {
        const project = await v21.createProject({
          title: this.title.trim(),
          aspectRatio: this.aspectRatio,
          genre: this.genre.trim(),
          description: this.description.trim(),
        })
        ElMessage.success('项目已创建')
        this.$router.replace(`/projects/${project.id}`)
      } catch (e) {
        ElMessage.error(e.message)
      } finally {
        this.creating = false
      }
    },
  },
}
</script>

<style scoped>
.page { padding: 24px 32px; max-width: 640px; }
.form { margin-top: 24px; background: #fff; padding: 24px; border-radius: 10px; border: 1px solid #e5e7eb; }
</style>
