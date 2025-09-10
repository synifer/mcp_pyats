import os, streamlit as st
# підхоплюємо Secrets як env (Cloud)
try: os.environ.update(st.secrets)
except: pass

st.set_page_config(page_title="MCPyATS – pyATS", layout="wide")
st.title("MCPyATS – pyATS agent")

# перевіримо обов'язкові змінні
req = ["PYATS_TESTBED_PATH","PYATS_USERNAME","PYATS_PASSWORD","FILESYSTEM_PATH"]
missing = [k for k in req if not os.getenv(k)]
if missing:
    st.error(f"В secrets/env відсутні: {', '.join(missing)}")
    st.stop()

st.success("Готово. Заповнено всі обов'язкові змінні середовища.")

# Проста перевірка доступу до testbed
tb_path = os.environ["PYATS_TESTBED_PATH"]
st.write("Testbed:", tb_path)
if not os.path.exists(tb_path):
    st.error("Файл testbed не знайдено. Переконайся, що шлях відносний до кореня репо.")
else:
    st.write("✅ testbed.yaml знайдено")

st.info("Тут можна додати кнопки: 'Connect', 'show version', 'collect interfaces' тощо.")
