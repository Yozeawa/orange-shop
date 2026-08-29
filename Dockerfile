FROM node:22-alpine

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制所有文件
COPY . .

# 暴露端口
EXPOSE 3456

# 启动应用
CMD ["npm", "start"]
