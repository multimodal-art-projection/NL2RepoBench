FROM nl2repobench-pi:1.5.2
RUN python -m pip install --no-cache-dir pytest==8.4.2
COPY evaluator_tests.py /tests/test_answer.py
ENTRYPOINT []
WORKDIR /workspace
CMD ["tail", "-f", "/dev/null"]
